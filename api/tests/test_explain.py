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


def test_explain_analyze_reports_measured_time_summed_over_queries(shop):
    c, _ = shop
    q = {"sql": USERS + ' WHERE "t0"."id" < $1', "params": [500]}
    one = c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [q]}], "analyze": True, "repeat": 3}).json()["results"][0]
    two = c.post("/api/explain", json={"candidates": [{"id": "b", "queries": [q, q]}], "analyze": True, "repeat": 3}).json()["results"][0]
    assert one["exec_ms"] > 0 and two["exec_ms"] > one["exec_ms"]
    plain = c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [q]}]}).json()["results"][0]
    assert plain["exec_ms"] is None


def test_explain_analyze_runs_the_query_several_times_and_takes_the_median(monkeypatch):
    from app import explain as ex

    times = iter([9.0, 1.0, 2.0, 3.0])  # first (cold) run is discarded, median of the next three
    class Conn:
        def execute(self, sql, vals=None):
            class R:
                def fetchone(self_inner):
                    return ([{"Plan": {"Total Cost": 5.0, "Plan Rows": 7, "Node Type": "Seq Scan"}, "Execution Time": next(times)}],)
            return R()
    cost, rows, summary, ms = ex.explain_query(Conn(), "select 1", [], analyze=True, repeat=3)
    assert ms == 2.0 and (cost, rows) == (5.0, 7.0)


def test_run_says_when_more_rows_exist_than_were_returned(shop):
    c, _ = shop
    few = c.post("/api/run", json={"query": {"sql": USERS}, "limit": 5}).json()
    assert few["row_count"] == 5 and few["truncated"] is True
    all_ = c.post("/api/run", json={"query": {"sql": USERS + " WHERE id <= 3"}, "limit": 5}).json()
    assert all_["row_count"] == 3 and all_["truncated"] is False
    exact = c.post("/api/run", json={"query": {"sql": USERS + " WHERE id <= 5"}, "limit": 5}).json()
    assert exact["row_count"] == 5 and exact["truncated"] is False  # exactly the limit is not "more"


READ_ONLY_SQL = {
    "left join": 'SELECT u.id, o.id FROM public.users u LEFT JOIN public.orders o ON o.user_id = u.id',
    "cte": "WITH big AS (SELECT user_id, count(*) n FROM public.orders GROUP BY user_id) SELECT u.email, big.n FROM public.users u JOIN big ON big.user_id = u.id",
    "window": "SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY id) FROM public.orders",
    "union": "SELECT id FROM public.users UNION ALL SELECT id FROM public.orders",
    "subquery + case": "SELECT id, CASE WHEN id > 5 THEN 'big' ELSE 'small' END FROM public.users WHERE id IN (SELECT user_id FROM public.orders)",
    "distinct on": "SELECT DISTINCT ON (user_id) user_id, id FROM public.orders ORDER BY user_id, id DESC",
}


@pytest.mark.parametrize("name", list(READ_ONLY_SQL))
def test_any_read_only_sql_can_be_explained_and_run(shop, name):
    c, _ = shop
    q = {"sql": READ_ONLY_SQL[name], "params": []}
    ex = c.post("/api/explain", json={"candidates": [{"id": "a", "queries": [q]}]}).json()["results"][0]
    assert ex["error"] is None and ex["total_cost"] > 0
    run = c.post("/api/run", json={"query": q, "limit": 5})
    assert run.status_code == 200 and run.json()["columns"]


@pytest.mark.parametrize("sql", [
    "DELETE FROM public.users",
    "WITH d AS (DELETE FROM public.users RETURNING *) SELECT * FROM d",
    "WITH i AS (INSERT INTO public.users(email,name) VALUES ('a','b') RETURNING *) SELECT * FROM i",
    "SELECT pg_sleep(0); DROP TABLE public.users",
])
def test_anything_that_writes_is_refused_and_nothing_changes(shop, sql):
    c, _ = shop
    before = c.post("/api/run", json={"query": {"sql": "SELECT count(*) FROM public.users"}}).json()["rows"]
    r = c.post("/api/run", json={"query": {"sql": sql, "params": []}})
    assert r.status_code == 400
    assert c.post("/api/run", json={"query": {"sql": "SELECT count(*) FROM public.users"}}).json()["rows"] == before
