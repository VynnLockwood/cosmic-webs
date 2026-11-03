"""Cross-language contract: Rust planner/ranker <-> Python API <-> real Postgres (no WASM needed)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sources import registry

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "core/target/release/examples/cli"

pytestmark = pytest.mark.skipif(shutil.which("cargo") is None, reason="cargo not installed")


@pytest.fixture(scope="module")
def cli():
    subprocess.run(["cargo", "build", "--release", "--example", "cli", "--manifest-path", str(ROOT / "core/Cargo.toml")], check=True, capture_output=True)
    return CLI


def call(cli, mode, payload):
    out = subprocess.run([str(cli), mode], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@pytest.fixture
def client(shop_db, monkeypatch):
    dsn, graph = shop_db
    monkeypatch.setenv("SANDBOX_DSN", dsn)
    registry.use_sandbox()
    registry.graph = graph
    yield TestClient(app), graph.model_dump(by_alias=True)
    registry.use_sandbox()
    registry.graph = None


def pipeline(cli, c, graph, request, analyze=False):
    cands = call(cli, "plan", {"graph": graph, "request": request})
    assert cands, "planner returned no candidates"
    explain = c.post("/api/explain", json={"candidates": cands, "analyze": analyze, "repeat": 2}).json()["results"]
    costs = [{"id": r["id"], "total_cost": r["total_cost"], "plan_rows": r["plan_rows"], "exec_ms": r.get("exec_ms"), "error": (r["error"] or {}).get("code") if r["error"] and r["error"]["code"] in ("PERMISSION", "TIMEOUT") else ("TYPE_MISMATCH" if r["error"] else None)} for r in explain]
    return cands, explain, call(cli, "rank", {"candidates": cands, "costs": costs})


def test_multi_hop_search_plans_explain_rank_and_run(cli, client):
    c, graph = client
    request = {"select": ["public.users.email", "public.orders.total", "public.products.name"], "where": {"col": "public.orders.status", "cmp": "=", "value": 0}, "fk_choices": {}}
    flags = call(cli, "diagnose", {"graph": graph, "request": request})
    assert [f["code"] for f in flags] == [], flags
    cands, explain, out = pipeline(cli, c, graph, request)
    assert all(r["error"] is None for r in explain), explain
    ranked = out["ranked"]
    assert 1 <= len(ranked) <= 5 and ranked == sorted(ranked, key=lambda r: r["score"])
    best = next(x for x in cands if x["id"] == ranked[0]["id"])
    for q in best["queries"]:
        res = c.post("/api/run", json={"query": q, "limit": 10}).json()
        assert res["row_count"] >= 0 and res["columns"]
    assert any("JOIN" in q["sql"] for x in cands for q in x["queries"])


def test_every_candidate_shape_explains_and_runs(cli, client):
    c, graph = client
    request = {"select": ["public.users.email", "public.orders.total"], "where": {"op": "AND", "children": [
        {"col": "public.users.name", "cmp": "ILIKE", "value": "%a%"}, {"col": "public.orders.status", "cmp": "<=", "value": 2}]}, "fk_choices": {}}
    cands, explain, _ = pipeline(cli, c, graph, request)
    assert {x["shape"] for x in cands} >= {"Join"}
    for cand in cands:
        for q in cand["queries"]:
            r = c.post("/api/run", json={"query": q, "limit": 5})
            assert r.status_code == 200, (cand["shape"], q["sql"], r.text)


def test_ambiguous_fk_flag_and_choice(cli, client):
    c, graph = client
    request = {"select": ["public.addresses.city", "public.orders.total"], "where": None, "fk_choices": {}}
    flags = call(cli, "diagnose", {"graph": graph, "request": request})
    assert "AMBIGUOUS_FK" in [f["code"] for f in flags]
    names = {f["id"] for f in graph["fks"] if f["from"]["table"] == "public.orders" and f["to"]["table"] == "public.addresses"}
    assert len(names) == 2
    chosen = {**request, "fk_choices": {"public.addresses|public.orders": sorted(names)[0]}}
    assert "AMBIGUOUS_FK" not in [f["code"] for f in call(cli, "diagnose", {"graph": graph, "request": chosen})]
    cands, explain, out = pipeline(cli, c, graph, chosen)
    assert out["ranked"] and all(r["error"] is None for r in explain)


def test_unreachable_table_is_flagged_and_dropped(cli, client):
    c, graph = client
    graph = {**graph, "tables": graph["tables"] + [{"name": "public.island", "columns": [{"name": "x", "type": "text", "nullable": True, "pk": False}], "row_estimate": 0}]}
    request = {"select": ["public.users.email", "public.island.x"], "where": None, "fk_choices": {}}
    flags = call(cli, "diagnose", {"graph": graph, "request": request})
    assert [f["code"] for f in flags] == ["UNREACHABLE"] and flags[0]["table"] == "public.island"
    cands = call(cli, "plan", {"graph": graph, "request": request})
    assert cands and all("island" not in q["sql"] for x in cands for q in x["queries"])


def test_values_with_quotes_and_percent_stay_params(cli, client):
    c, graph = client
    evil = "x' OR 1=1 --; %"
    request = {"select": ["public.users.email"], "where": {"col": "public.users.name", "cmp": "ILIKE", "value": evil}, "fk_choices": {}}
    cands, explain, out = pipeline(cli, c, graph, request)
    assert all(evil not in q["sql"] for x in cands for q in x["queries"])
    q = next(x for x in cands if x["id"] == out["ranked"][0]["id"])["queries"][0]
    assert c.post("/api/run", json={"query": q}).json()["row_count"] == 0


def test_measured_run_time_flows_through_the_ranker_with_a_full_score_sheet(cli, client):
    c, graph = client
    request = {"select": ["public.users.email", "public.orders.total"], "where": {"col": "public.orders.status", "cmp": "<=", "value": 2}, "fk_choices": {}}
    cands, explain, out = pipeline(cli, c, graph, request, analyze=True)
    assert all(r["exec_ms"] and r["exec_ms"] > 0 for r in explain)
    ranked = out["ranked"]
    assert ranked and all(r["metric"] == "time" for r in ranked)
    for r in ranked:
        d = r["detail"]
        assert abs(sum(m["points"] for m in d.values()) - r["score"]) < 1e-9
        assert r["compared"] == len(cands)


def test_adding_an_index_lowers_the_best_plans_cost_and_time_via_the_real_ranker(cli, pg_dsn, monkeypatch):
    """The 'structure lab' loop: search, change the structure, search again, compare the best plans."""
    from app.ddl import parse_ddl
    from app.sandbox import rebuild_sandbox

    ddl = "create table customers(id serial primary key, name text); create table orders(id serial primary key, customer_id int references customers(id), total numeric(10,2));"
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    graph = rebuild_sandbox(ddl, parse_ddl(ddl).graph, rows_per_table=30000, dsn=pg_dsn)
    registry.use_sandbox()
    registry.graph = graph
    c = TestClient(app)
    request = {"select": ["public.orders.id", "public.orders.total"], "where": {"col": "public.orders.customer_id", "cmp": "=", "value": 42}, "fk_choices": {}}

    def best(analyze):
        g = c.get("/api/structure").json()["graph"]
        cands, explain, out = pipeline(cli, c, g, request, analyze=analyze)
        return out["ranked"][0]

    before_cost, before_time = best(False), best(True)
    r = c.post("/api/structure/apply", json={"ops": [{"kind": "create_index", "table": "public.orders", "columns": ["customer_id"]}]})
    assert r.status_code == 200, r.text
    after_cost, after_time = best(False), best(True)
    assert after_cost["detail"]["cost"]["value"] < before_cost["detail"]["cost"]["value"] / 5
    assert after_time["metric"] == "time"
    assert after_time["detail"]["cost"]["value"] < before_time["detail"]["cost"]["value"]
    registry.use_sandbox()
    registry.graph = None
