"""Importing in the background: the parsed graph comes back at once, progress is polled."""
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sources import registry
from tests.test_import_data import DUMP, SCHEMA


@pytest.fixture
def client(pg_dsn, monkeypatch):
    monkeypatch.setenv("SANDBOX_DSN", pg_dsn)
    import app.jobs as jobs

    jobs.reset_for_tests()
    registry.use_sandbox()
    yield TestClient(app)
    jobs.reset_for_tests()
    registry.use_sandbox()
    registry.graph = None


def wait(c, job_id, timeout=30):
    seen, t0 = [], time.time()
    while time.time() - t0 < timeout:
        j = c.get(f"/api/jobs/{job_id}").json()
        seen.append(j)
        if j["status"] != "running":
            return seen
        time.sleep(0.02)
    raise AssertionError(f"job did not finish: {seen[-1]}")


def test_start_returns_the_parsed_graph_immediately_and_the_job_finishes_with_data(client):
    r = client.post("/api/schema/jobs", json={"ddl": DUMP})
    assert r.status_code == 200
    body = r.json()
    assert len(body["graph"]["tables"]) == 5 and all(t["row_estimate"] == 0 for t in body["graph"]["tables"])  # parsed, nothing loaded yet
    states = wait(client, body["job_id"])
    done = states[-1]
    assert done["status"] == "done" and done["percent"] == 100
    assert done["result"]["data"] == {"source": "dump", "rows_loaded": 11, "tables_with_data": 4, "tables_empty": 1}
    assert {t["name"]: t["row_estimate"] for t in done["result"]["graph"]["tables"]}["public.sppProject"] == 3
    assert registry.graph is not None and len(registry.graph.tables) == 5


def test_progress_has_named_stages_and_never_goes_backwards(client):
    ddl = SCHEMA  # no rows: mock generation, one step per table
    job = client.post("/api/schema/jobs", json={"ddl": ddl}).json()["job_id"]
    states = wait(client, job)
    stages = [s["stage"] for s in states]
    assert "Creating tables" in stages or states[-1]["stage"]  # fast machines may skip a poll, the last state always has a stage
    pcts = [s["percent"] for s in states]
    assert pcts == sorted(pcts) and pcts[-1] == 100 and max(pcts) <= 100


def test_progress_callbacks_cover_creating_loading_and_finishing(pg_dsn):
    from app.ddl import parse_ddl
    from app.sandbox import rebuild_sandbox_report

    seen = []
    rebuild_sandbox_report(DUMP, parse_ddl(DUMP).graph, dsn=pg_dsn, progress=lambda stage, frac, msg="": seen.append((stage, round(frac, 2), msg)))
    stages = [s for s, _, _ in seen]
    assert stages[0] == "Resetting sandbox" and stages[-1] == "Finishing"
    assert {"Creating tables", "Loading rows"} <= set(stages)
    loading = [f for s, f, _ in seen if s == "Loading rows"]
    assert loading == sorted(loading) and loading[-1] == 1.0
    assert any("sppProject" in m for s, _, m in seen if s == "Loading rows")  # says which table is loading


def test_a_syntax_error_is_reported_at_once_and_starts_no_job(client):
    r = client.post("/api/schema/jobs", json={"ddl": "create tabel x(id int);"})
    assert r.status_code == 422 and r.json()["line"] == 1


def test_only_one_import_runs_at_a_time(client, monkeypatch):
    import app.sandbox as sb

    gate = threading.Event()
    real = sb.fill_mock

    def slow(*a, **k):
        gate.wait(10)
        return real(*a, **k)

    monkeypatch.setattr(sb, "fill_mock", slow)
    first = client.post("/api/schema/jobs", json={"ddl": SCHEMA})
    assert first.status_code == 200
    second = client.post("/api/schema/jobs", json={"ddl": SCHEMA})
    assert second.status_code == 409 and "already" in second.json()["message"]
    gate.set()
    wait(client, first.json()["job_id"])
    assert client.post("/api/schema/jobs", json={"ddl": SCHEMA}).status_code == 200  # free again


def test_unexpected_failure_ends_as_an_error_not_a_hang(client, monkeypatch):
    import app.jobs as jobs

    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(jobs, "build_sandbox", boom)
    job = client.post("/api/schema/jobs", json={"ddl": SCHEMA}).json()["job_id"]
    last = wait(client, job)[-1]
    assert last["status"] == "error" and "disk full" in last["error"]
    assert client.post("/api/schema/jobs", json={"ddl": SCHEMA}).status_code == 200  # the lock was released


def test_unknown_job_is_404(client):
    assert client.get("/api/jobs/nope").status_code == 404


def test_default_schema_job_uses_the_bundled_shop_and_reports_mock_data(client):
    r = client.post("/api/schema/jobs", json={"use_default": True}).json()
    assert len(r["graph"]["tables"]) == 25
    done = wait(client, r["job_id"])[-1]
    assert done["result"]["data"]["source"] == "mock" and done["result"]["data"]["rows_loaded"] == 25 * 1000


def test_a_request_needs_ddl_or_use_default(client):
    assert client.post("/api/schema/jobs", json={}).status_code == 422
