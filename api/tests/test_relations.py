"""Suggested links: relations the schema does not declare but names (and, when real, data) reveal."""
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ddl import parse_ddl
from app.main import app
from app.relations import name_candidates, suggest
from app.sandbox import rebuild_sandbox_report
from app.sources import registry
from tests.test_import_data import DUMP, SCHEMA

T = "\t"


def graph_of(ddl):
    return parse_ddl(ddl).graph


def names(cands):
    return {(c.from_table.split(".")[1], c.from_columns[0], c.to_table.split(".")[1]) for c in cands}


def test_column_named_like_a_table_is_a_candidate_but_declared_fks_are_not():
    got = names(name_candidates(graph_of(SCHEMA)))
    assert ("sppAddress", "sppProject", "sppProject") in got
    assert ("sppCase", "sppProject", "sppProject") in got
    assert not any(c[0] == "sppProject" and c[1] in ("mtFuel", "mtZone") for c in got)  # already declared FKs


def test_id_suffix_and_plural_conventions():
    ddl = """create table customers(id serial primary key); create table categories(id serial primary key);
             create table orders(id serial primary key, customer_id int, category_id int, note_id int, customers_id text);"""
    got = names(name_candidates(graph_of(ddl)))
    assert ("orders", "customer_id", "customers") in got and ("orders", "category_id", "categories") in got
    assert not any(c[1] == "note_id" for c in got)  # no table notes
    assert not any(c[1] == "customers_id" for c in got)  # text column, integer key: types differ


def test_a_table_is_never_suggested_to_reference_itself_and_id_columns_are_ignored():
    got = names(name_candidates(graph_of("create table a(id int primary key, a int, b_id int);")))
    assert got == set()


@pytest.fixture
def lab(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    registry.use_sandbox()
    yield pg_dsn
    registry.use_sandbox()
    registry.graph = None


def run_suggest(dsn, report, use_data):
    registry.graph = report.graph
    with registry.session() as s:
        return suggest(s, report.graph, use_data=use_data)


def test_real_data_confirms_a_relation_and_unknown_cases_are_kept(lab):
    rep = rebuild_sandbox_report(DUMP, graph_of(DUMP), dsn=lab)
    got = {(s.from_table.split(".")[1], s.from_columns[0]): s for s in run_suggest(lab, rep, True)}
    addr = got[("sppAddress", "sppProject")]
    assert (addr.verified, addr.checked, addr.matched) == (True, 3, 3)
    case = got[("sppCase", "sppProject")]
    assert (case.verified, case.checked) == (False, None)  # the table is empty: nothing to check, name match only
    assert list(got).index(("sppAddress", "sppProject")) < list(got).index(("sppCase", "sppProject"))  # verified first


def test_a_name_match_contradicted_by_the_data_is_dropped(lab):
    ddl = SCHEMA.replace("city text);", 'city text, "mtZone" uuid);')
    data = DUMP.replace(SCHEMA, ddl).replace(f"{('aaaaaaaa-0000-0000-0000-000000000001')}{T}", f"aaaaaaaa-0000-0000-0000-000000000001{T}", 1)
    # three address rows get a random (non-existent) zone id
    data = data.replace('COPY public."sppAddress" ("addressID", "sppProject", city)', 'COPY public."sppAddress" ("addressID", "sppProject", city, "mtZone")')
    lines = []
    for line in data.split("\n"):
        lines.append(line + f"{T}99999999-0000-0000-0000-000000000009" if line.startswith("aaaaaaaa-") else line)
    data = "\n".join(lines)
    rep = rebuild_sandbox_report(data, graph_of(data), dsn=lab)
    assert rep.warnings == [], rep.warnings
    got = names(run_suggest(lab, rep, True))
    assert ("sppAddress", "sppProject", "sppProject") in got
    assert ("sppAddress", "mtZone", "mtZone") not in got


def test_mock_data_proves_nothing_so_names_alone_decide(lab):
    rep = rebuild_sandbox_report(SCHEMA, graph_of(SCHEMA), rows_per_table=30, dsn=lab)
    s = {(x.from_table.split(".")[1], x.from_columns[0]): x for x in run_suggest(lab, rep, False)}
    assert ("sppAddress", "sppProject") in s and s[("sppAddress", "sppProject")].checked is None


def test_endpoint_lists_suggestions_and_adding_one_removes_it(lab):
    c = TestClient(app)
    c.post("/api/schema", json={"ddl": DUMP})
    body = c.get("/api/relations/suggest").json()
    assert body["data_source"] == "dump"
    sug = next(x for x in body["suggestions"] if x["from_table"] == "public.sppAddress" and x["from_columns"] == ["sppProject"])
    assert sug["verified"] and sug["matched"] == 3
    r = c.post("/api/structure/apply", json={"ops": [{"kind": "add_fk", "table": sug["from_table"], "columns": sug["from_columns"], "ref_table": sug["to_table"], "ref_columns": sug["to_columns"]}]})
    assert r.status_code == 200, r.text
    again = c.get("/api/relations/suggest").json()["suggestions"]
    assert not any(x["from_table"] == "public.sppAddress" and x["from_columns"] == ["sppProject"] for x in again)


def test_refilling_with_mock_rows_switches_to_name_only_evidence(lab):
    c = TestClient(app)
    c.post("/api/schema", json={"ddl": DUMP})
    c.post("/api/sandbox/refill", json={"rows_per_table": 20})
    assert c.get("/api/relations/suggest").json()["data_source"] == "mock"
