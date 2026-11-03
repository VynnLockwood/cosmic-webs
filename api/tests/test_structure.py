import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ddl import parse_ddl
from app.main import app
from app.sandbox import rebuild_sandbox
from app.sources import registry

DDL = """
create table customers(id serial primary key, name text);
create table orders(id serial primary key, customer_id int, total numeric(10,2), status int);
"""


@pytest.fixture
def lab(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    graph = rebuild_sandbox(DDL, parse_ddl(DDL).graph, rows_per_table=20000, dsn=pg_dsn)
    registry.use_sandbox()
    registry.graph = graph
    yield TestClient(app), pg_dsn
    registry.use_sandbox()
    registry.graph = None


def apply(c, *ops):
    return c.post("/api/structure/apply", json={"ops": list(ops)})


def explain_cost(c, sql, params):
    r = c.post("/api/explain", json={"candidates": [{"id": "x", "queries": [{"sql": sql, "params": params}]}]}).json()["results"][0]
    assert r["error"] is None, r
    return r["total_cost"]


def test_state_lists_tables_and_indexes(lab):
    c, _ = lab
    s = c.get("/api/structure").json()
    assert {t["name"] for t in s["graph"]["tables"]} == {"public.customers", "public.orders"}
    names = {(i["table"], tuple(i["columns"]), i["primary"]) for i in s["indexes"]}
    assert ("public.orders", ("id",), True) in names


def test_create_index_is_listed_and_makes_the_filter_cheaper(lab):
    c, _ = lab
    q = 'SELECT "t0"."id" FROM "public"."orders" AS "t0" WHERE "t0"."customer_id" = $1'
    before = explain_cost(c, q, [7])
    r = apply(c, {"kind": "create_index", "table": "public.orders", "columns": ["customer_id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(i["table"] == "public.orders" and i["columns"] == ["customer_id"] and not i["unique"] for i in body["indexes"])
    assert body["executed"] and body["executed"][0].startswith("CREATE INDEX")
    after = explain_cost(c, q, [7])
    assert after < before / 5, (before, after)  # index scan instead of a sequential scan over 20 000 rows


def test_drop_index_makes_it_expensive_again(lab):
    c, _ = lab
    q = 'SELECT "t0"."id" FROM "public"."orders" AS "t0" WHERE "t0"."customer_id" = $1'
    created = apply(c, {"kind": "create_index", "table": "public.orders", "columns": ["customer_id"]}).json()
    name = next(i["name"] for i in created["indexes"] if i["columns"] == ["customer_id"])
    cheap = explain_cost(c, q, [7])
    r = apply(c, {"kind": "drop_index", "schema": "public", "name": name})
    assert r.status_code == 200 and not any(i["name"] == name for i in r.json()["indexes"])
    assert explain_cost(c, q, [7]) > cheap * 5


def test_add_fk_adds_a_link_and_drop_fk_removes_it(lab):
    c, _ = lab
    r = apply(c, {"kind": "add_fk", "table": "public.orders", "columns": ["customer_id"], "ref_table": "public.customers", "ref_columns": ["id"]})
    assert r.status_code == 200, r.text
    fks = r.json()["graph"]["fks"]
    assert [(f["from"]["table"], f["from"]["columns"], f["to"]["table"]) for f in fks] == [("public.orders", ["customer_id"], "public.customers")]
    r2 = apply(c, {"kind": "drop_fk", "table": "public.orders", "name": fks[0]["id"]})
    assert r2.status_code == 200 and r2.json()["graph"]["fks"] == []


def test_add_and_drop_column(lab):
    c, _ = lab
    r = apply(c, {"kind": "add_column", "table": "public.orders", "name": "note", "type": "text"})
    assert r.status_code == 200
    cols = {x["name"]: x for t in r.json()["graph"]["tables"] if t["name"] == "public.orders" for x in t["columns"]}
    assert cols["note"]["type"] == "text" and cols["note"]["nullable"] is True
    r2 = apply(c, {"kind": "drop_column", "table": "public.orders", "name": "note"})
    assert "note" not in {x["name"] for t in r2.json()["graph"]["tables"] if t["name"] == "public.orders" for x in t["columns"]}


@pytest.mark.parametrize("op", [
    {"kind": "create_index", "table": "public.nope", "columns": ["id"]},
    {"kind": "create_index", "table": "public.orders", "columns": ["nope"]},
    {"kind": "create_index", "table": "public.orders", "columns": []},
    {"kind": "add_column", "table": "public.orders", "name": "x", "type": "text; drop table orders"},
    {"kind": "drop_index", "schema": "public", "name": "orders_pkey\"; drop table orders; --"},
    {"kind": "create_index", "table": 'public.orders"; drop table customers; --', "columns": ["id"]},
])
def test_bad_or_hostile_ops_are_rejected_and_nothing_changes(lab, op):
    c, dsn = lab
    r = apply(c, op)
    assert r.status_code == 400 and r.json()["message"]
    with psycopg.connect(dsn) as conn:
        assert conn.execute("select count(*) from customers").fetchone()[0] == 20000


def test_a_failing_op_rolls_back_the_ops_before_it(lab):
    c, _ = lab
    r = apply(c, {"kind": "create_index", "table": "public.orders", "columns": ["status"]}, {"kind": "create_index", "table": "public.orders", "columns": ["nope"]})
    assert r.status_code == 400
    assert not any(i["columns"] == ["status"] for i in c.get("/api/structure").json()["indexes"])


def test_raw_ddl_is_limited_to_schema_changes(lab):
    c, _ = lab
    ok = apply(c, {"kind": "sql", "statement": "create index orders_total_idx on orders (total)"})
    assert ok.status_code == 200, ok.text
    for bad in ["drop schema public cascade", "copy orders to program 'ls'", "select pg_read_file('/etc/passwd')", "delete from orders", "create index a on orders(id); drop table orders", "do $$ begin end $$"]:
        r = apply(c, {"kind": "sql", "statement": bad})
        assert r.status_code == 400, bad


def test_editing_is_sandbox_only(lab):
    c, dsn = lab
    from psycopg.conninfo import conninfo_to_dict

    from app.sources import LiveParams

    d = conninfo_to_dict(dsn)
    registry.use_live(LiveParams(host=d["host"], port=int(d["port"]), dbname=d["dbname"], user=d["user"], password=""))
    r = apply(c, {"kind": "create_index", "table": "public.orders", "columns": ["status"]})
    assert r.status_code == 409
    assert c.get("/api/structure").status_code == 409
    assert c.post("/api/sandbox/refill", json={"rows_per_table": 10}).status_code == 409


def test_refill_changes_the_data_size_and_keeps_fks_valid(lab):
    c, dsn = lab
    apply(c, {"kind": "add_fk", "table": "public.orders", "columns": ["customer_id"], "ref_table": "public.customers", "ref_columns": ["id"], "validate": False})
    r = c.post("/api/sandbox/refill", json={"rows_per_table": 3000})
    assert r.status_code == 200, r.text
    assert {t["name"]: t["row_estimate"] for t in r.json()["graph"]["tables"]} == {"public.customers": 3000, "public.orders": 3000}
    with psycopg.connect(dsn) as conn:
        assert conn.execute("select count(*) from orders o where not exists (select 1 from customers c where c.id = o.customer_id)").fetchone()[0] == 0
        assert conn.execute("select count(*) from orders").fetchone()[0] == 3000


@pytest.mark.parametrize("n", [0, -5, 100001])
def test_refill_size_is_bounded(lab, n):
    c, _ = lab
    assert c.post("/api/sandbox/refill", json={"rows_per_table": n}).status_code == 422


def test_ddl_runs_without_superuser_rights(lab):
    """A column DEFAULT is evaluated by the DDL statement itself: it must not be able to read server files."""
    c, dsn = lab
    r = apply(c, {"kind": "sql", "statement": "alter table orders add column leak text default pg_read_file('/etc/hostname')"})
    assert r.status_code == 400 and "permission denied" in r.json()["message"]
    with psycopg.connect(dsn) as conn:
        cols = {row[0] for row in conn.execute("select column_name from information_schema.columns where table_name = 'orders'")}
    assert "leak" not in cols
