"""Structure lab export: pg_dump of the sandbox as a downloadable .sql file."""
import pytest
from fastapi.testclient import TestClient

from app.ddl import parse_ddl
from app.main import app
from app.sandbox import rebuild_sandbox
from app.sources import registry

DDL = """
create table customers(id serial primary key, name text);
create table orders(id serial primary key, customer_id int references customers(id), total numeric(10,2));
"""


@pytest.fixture
def lab(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    graph = rebuild_sandbox(DDL, parse_ddl(DDL).graph, rows_per_table=30, dsn=pg_dsn)
    registry.use_sandbox()
    registry.graph = graph
    yield TestClient(app)
    registry.use_sandbox()
    registry.graph = None


def test_schema_export_has_tables_keys_and_no_rows(lab):
    r = lab.get("/api/structure/export?kind=schema")
    assert r.status_code == 200
    assert 'attachment; filename="cosmic-webs-structure.sql"' in r.headers["content-disposition"]
    body = r.text
    assert 'CREATE TABLE public.customers' in body and 'CREATE TABLE public.orders' in body
    assert "FOREIGN KEY (customer_id) REFERENCES public.customers(id)" in body
    assert "COPY " not in body and "OWNER TO" not in body


def test_full_export_also_carries_the_rows(lab):
    r = lab.get("/api/structure/export?kind=full")
    assert r.status_code == 200 and "COPY public.customers" in r.text
    assert r.headers["content-disposition"].endswith('cosmic-webs-structure-and-data.sql"')


def test_export_shows_the_changes_made_in_the_lab(lab):
    lab.post("/api/structure/apply", json={"ops": [{"kind": "create_index", "table": "public.orders", "columns": ["total"]}]})
    assert "CREATE INDEX" in lab.get("/api/structure/export?kind=schema").text


def test_unknown_kind_is_422_and_live_mode_is_409(lab):
    assert lab.get("/api/structure/export?kind=nope").status_code == 422
    registry.mode = "live"
    try:
        assert lab.get("/api/structure/export?kind=schema").status_code == 409
    finally:
        registry.use_sandbox()
