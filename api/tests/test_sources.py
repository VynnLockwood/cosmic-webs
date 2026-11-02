import logging

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict

from app.ddl import parse_ddl
from app.introspect import introspect
from app.main import app
from app.sources import LiveParams, registry


def params(dsn, **kw) -> LiveParams:
    d = conninfo_to_dict(dsn)
    return LiveParams(host=d["host"], port=int(d["port"]), dbname=d["dbname"], user=d["user"], password="", **kw)


@pytest.fixture(autouse=True)
def reset_registry():
    registry.use_sandbox()
    registry.graph = None
    yield
    registry.use_sandbox()
    registry.graph = None


def test_live_session_is_read_only(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as c:
        c.execute("create table x(id int)")
    registry.use_live(params(pg_dsn))
    assert registry.mode == "live"
    with registry.session() as s:
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            s.execute("insert into x values (1)")


def test_live_statement_timeout_is_5s(pg_dsn):
    registry.use_live(params(pg_dsn))
    with registry.session() as s:
        assert s.execute("show statement_timeout").fetchone()[0] == "5s"


def test_connect_failure_400_message(pg_dsn):
    c = TestClient(app)
    r = c.post("/api/source/live", json={"host": "127.0.0.1", "port": 1, "dbname": "x", "user": "u", "password": "s3cret-pw"})
    assert r.status_code == 400 and r.json()["message"] and "s3cret-pw" not in r.text
    assert registry.mode == "sandbox"


def test_password_never_logged(pg_dsn, caplog):
    caplog.set_level(logging.DEBUG)
    c = TestClient(app)
    c.post("/api/source/live", json={"host": "127.0.0.1", "port": 1, "dbname": "x", "user": "u", "password": "s3cret-pw"})
    assert "s3cret-pw" not in caplog.text


def test_introspect_matches_ddl_graph(shop_db):
    dsn, _ = shop_db
    from pathlib import Path

    expected = parse_ddl((Path(__file__).resolve().parents[2] / "samples/shop.sql").read_text()).graph
    with psycopg.connect(dsn) as c:
        got = introspect(c, "public")
    cols = lambda g: {(t.name, c.name, c.type, c.nullable, c.pk) for t in g.tables for c in t.columns}
    fks = lambda g: {(f.from_.table, tuple(f.from_.columns), f.to.table, tuple(f.to.columns)) for f in g.fks}
    assert {t.name for t in got.tables} == {t.name for t in expected.tables}
    assert cols(got) == cols(expected)
    assert fks(got) == fks(expected)


@pytest.fixture
def shop_client(shop_db, monkeypatch):
    dsn, graph = shop_db
    monkeypatch.setenv("SANDBOX_DSN", dsn)
    registry.use_sandbox()
    registry.graph = graph
    return TestClient(app)


def test_rows_paging(shop_client):
    first = shop_client.get("/api/tables/public.users/rows", params={"limit": 10, "offset": 0}).json()
    page = shop_client.get("/api/tables/public.users/rows", params={"limit": 5, "offset": 5}).json()
    idx = first["columns"].index("id")
    assert [r[idx] for r in page["rows"]] == [r[idx] for r in first["rows"][5:10]]
    assert page["total_estimate"] == 1000


def test_rows_unknown_table_404(shop_client):
    assert shop_client.get("/api/tables/public.nope/rows").status_code == 404
    assert shop_client.get("/api/tables/public.users; drop table x/rows").status_code == 404


def test_rows_limit_capped_200(shop_client):
    assert len(shop_client.get("/api/tables/public.users/rows", params={"limit": 9999}).json()["rows"]) == 200
