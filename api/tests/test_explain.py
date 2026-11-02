import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict

from app.explain import to_driver_sql
from app.main import app
from app.sandbox import grant_reader
from app.sources import LiveParams, registry

USERS = 'SELECT "t0"."id" FROM "public"."users" AS "t0"'


@pytest.fixture(autouse=True)
def reset():
    registry.use_sandbox()
    registry.graph = None
    yield
    registry.use_sandbox()
    registry.graph = None


@pytest.fixture
def shop(shop_db, monkeypatch):
    dsn, graph = shop_db
    monkeypatch.setenv("SANDBOX_DSN", dsn)
    registry.graph = graph
    return TestClient(app), dsn


def live(dsn, user=None, **kw):
    d = conninfo_to_dict(dsn)
    return LiveParams(host=d["host"], port=int(d["port"]), dbname=d["dbname"], user=user or d["user"], password="", **kw)


def test_to_driver_sql_order_and_percent():
    sql, vals = to_driver_sql('select "50%" from t where a = $2 and b = $1 and c = $2', ["x", "y"])
    assert sql == 'select "50%%" from t where a = %s and b = %s and c = %s'
    assert vals == ["y", "x", "y"]


def test_dollar_params_and_percent_identifier(pg_dsn, monkeypatch):
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute('create table "50%" (x int)')
        c.execute('insert into "50%" select generate_series(1,10)')
        grant_reader(c)  # tables made outside rebuild_sandbox need the reader grants
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    r = TestClient(app).post("/api/run", json={"query": {"sql": 'SELECT "t0"."x" FROM "public"."50%" AS "t0" WHERE "t0"."x" >= $1 AND "t0"."x" <= $1', "params": [5]}})
    assert r.json()["rows"] == [[5]]


def test_explain_returns_cost(shop):
    c, _ = shop
    r = c.post("/api/explain", json={"candidates": [{"id": "c1", "queries": [{"sql": USERS + ' WHERE "t0"."id" = $1', "params": [3]}]}]}).json()["results"][0]
    assert r["total_cost"] > 0 and r["plan_rows"] > 0 and r["error"] is None


def test_explain_sums_split_queries(shop):
    c, _ = shop
    one = {"sql": USERS, "params": []}
    res = c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [one]}, {"id": "b", "queries": [one, one]}]}).json()["results"]
    assert res[1]["total_cost"] == pytest.approx(2 * res[0]["total_cost"])


@pytest.mark.parametrize("sql", ["DROP TABLE users", "SELECT 1; SELECT 2", "SELECT * INTO x FROM users"])
def test_rejects_non_select(shop, sql):
    c, _ = shop
    assert c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [{"sql": sql}]}]}).status_code == 400
    assert c.post("/api/run", json={"query": {"sql": sql}}).status_code == 400


def test_live_analyze_forbidden_by_default(shop):
    c, dsn = shop
    registry.use_live(live(dsn))
    r = c.post("/api/explain", json={"candidates": [], "analyze": True})
    assert r.status_code == 403
    registry.use_live(live(dsn, allow_analyze=True))
    assert c.post("/api/explain", json={"candidates": [], "analyze": True}).status_code == 200


def test_permission_error_mapped(shop, pg_server):
    c, dsn = shop
    with psycopg.connect(pg_server + "/postgres", autocommit=True) as a:
        a.execute("drop role if exists lowpriv")
        a.execute("create role lowpriv login")
    registry.use_live(live(dsn, user="lowpriv"))
    r = c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [{"sql": USERS}]}]}).json()["results"][0]
    assert r["error"]["code"] == "PERMISSION"


def test_timeout_mapped(shop):
    c, dsn = shop
    registry.use_live(live(dsn))
    r = c.post("/api/run", json={"query": {"sql": "SELECT pg_sleep(10)"}})
    assert r.status_code == 400 and r.json()["code"] == "TIMEOUT"


def test_run_limit_default_and_cap(shop):
    c, _ = shop
    assert len(c.post("/api/run", json={"query": {"sql": USERS}}).json()["rows"]) == 100
    assert len(c.post("/api/run", json={"query": {"sql": USERS}, "limit": 5000}).json()["rows"]) == 1000


def test_run_empty_flag(shop):
    c, _ = shop
    r = c.post("/api/run", json={"query": {"sql": USERS + " WHERE 1=0"}}).json()
    assert r["row_count"] == 0 and r["flags"][0]["code"] == "EMPTY_RESULT"


def test_injection_value_is_data(shop):
    c, dsn = shop
    r = c.post("/api/run", json={"query": {"sql": 'SELECT "t0"."id" FROM "public"."users" AS "t0" WHERE "t0"."name" = $1', "params": ["x' OR 1=1 --"]}}).json()
    assert r["row_count"] == 0
    with psycopg.connect(dsn) as conn:
        assert conn.execute("select count(*) from users").fetchone()[0] == 1000
