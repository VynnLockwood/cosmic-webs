import psycopg

from app.ddl import parse_ddl
from app.mockdata import fk_load_order
from app.sandbox import rebuild_sandbox

ROOT_SQL = "samples/shop.sql"


def q(name: str) -> str:
    s, t = name.split(".", 1)
    return f'"{s}"."{t}"'


def test_topo_order_parents_first():
    from pathlib import Path

    g = parse_ddl((Path(__file__).resolve().parents[2] / ROOT_SQL).read_text()).graph
    order, deferred = fk_load_order(g)
    pos = {t: i for i, t in enumerate(order)}
    assert sorted(order) == sorted(t.name for t in g.tables)
    dids = {f.id for f in deferred}
    for f in g.fks:
        if f.id not in dids:
            assert pos[f.to.table] < pos[f.from_.table]


def test_cycle_returns_deferred_fk():
    g = parse_ddl("create table a(id int primary key, b_id int references b(id)); create table b(id int primary key, a_id int references a(id));").graph
    order, deferred = fk_load_order(g)
    assert len(deferred) == 1 and len(order) == 2


def test_all_fk_values_exist_in_parent(shop_db):
    dsn, graph = shop_db
    with psycopg.connect(dsn) as c:
        for f in graph.fks:
            cond = " and ".join(f'c."{a}" = p."{b}"' for a, b in zip(f.from_.columns, f.to.columns))
            notnull = " and ".join(f'c."{a}" is not null' for a in f.from_.columns)
            n = c.execute(f"select count(*) from {q(f.from_.table)} c where {notnull} and not exists (select 1 from {q(f.to.table)} p where {cond})").fetchone()[0]
            assert n == 0, f.id


def test_self_reference_rows_valid(shop_db):
    dsn, _ = shop_db
    with psycopg.connect(dsn) as c:
        bad = c.execute("select count(*) from employees e where manager_id is not null and not exists (select 1 from employees m where m.id = e.manager_id)").fetchone()[0]
        nulls = c.execute("select count(*) from employees where manager_id is null").fetchone()[0]
    assert bad == 0 and nulls >= 1


def test_default_rows_1000(shop_db):
    dsn, graph = shop_db
    with psycopg.connect(dsn) as c:
        for t in graph.tables:
            assert c.execute(f"select count(*) from {q(t.name)}").fetchone()[0] == 1000, t.name
    assert all(t.row_estimate == 1000 for t in graph.tables)


def test_types_covered(pg_dsn):
    ddl = "create type mood as enum ('a','b'); create table t(i int4, b8 int8, s text, v varchar(5), u uuid, ts timestamptz, d date, n numeric(8,2), f bool, j jsonb, e mood);"
    out = rebuild_sandbox(ddl, parse_ddl(ddl).graph, rows_per_table=20, dsn=pg_dsn)
    with psycopg.connect(pg_dsn) as c:
        assert c.execute("select count(*) from t").fetchone()[0] == 20
        assert c.execute("select count(distinct e) from t").fetchone()[0] >= 1
    assert out.tables[0].row_estimate == 20


def test_rebuild_drops_old_tables(pg_dsn):
    a = "create table old_one(id int primary key);"
    b = "create table new_one(id int primary key);"
    rebuild_sandbox(a, parse_ddl(a).graph, rows_per_table=5, dsn=pg_dsn)
    rebuild_sandbox(b, parse_ddl(b).graph, rows_per_table=5, dsn=pg_dsn)
    with psycopg.connect(pg_dsn) as c:
        names = {r[0] for r in c.execute("select tablename from pg_tables where schemaname='public'")}
    assert names == {"new_one"}


def test_post_schema_rebuilds_sandbox(pg_dsn, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    r = TestClient(app).post("/api/schema", json={"ddl": "create table z(id serial primary key, v text);"})
    assert r.json()["graph"]["tables"][0]["row_estimate"] == 1000
    with psycopg.connect(pg_dsn) as c:
        assert c.execute("select count(*) from z").fetchone()[0] == 1000
