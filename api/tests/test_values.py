"""Distinct values of a column for the condition value autocomplete."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sources import registry


@pytest.fixture
def client(shop_db, monkeypatch):
    dsn, graph = shop_db
    monkeypatch.setenv("SANDBOX_DSN", dsn)
    registry.use_sandbox()
    registry.graph = graph
    yield TestClient(app)
    registry.use_sandbox()
    registry.graph = None


def get(c, table, col, **params):
    return c.get(f"/api/tables/{table}/columns/{col}/values", params=params)


def test_lists_distinct_values_most_frequent_first_with_counts(client):
    r = get(client, "public.orders", "status").json()
    assert r["values"] and all(set(v) == {"value", "count"} for v in r["values"])
    counts = [v["count"] for v in r["values"]]
    assert counts == sorted(counts, reverse=True)
    assert sum(counts) == 1000 and r["truncated"] is False


def test_search_text_filters_any_type_case_insensitively(client):
    all_ = get(client, "public.users", "email", limit=5).json()
    assert len(all_["values"]) == 5 and all_["truncated"] is True
    needle = all_["values"][0]["value"][:4].upper()
    found = get(client, "public.users", "email", q=needle, limit=200).json()["values"]
    assert found and all(needle.lower() in v["value"].lower() for v in found)
    ints = get(client, "public.orders", "id", q="99", limit=200).json()["values"]
    assert ints and all("99" in str(v["value"]) for v in ints)


def test_percent_and_underscore_in_the_search_are_literal(client):
    assert get(client, "public.users", "email", q="%").json()["values"] == []


def test_nulls_are_left_out_and_limit_is_capped(client):
    r = get(client, "public.users", "email", limit=100000).json()
    assert all(v["value"] is not None for v in r["values"]) and len(r["values"]) <= 200


def test_unknown_table_or_column_is_404(client):
    assert get(client, "public.nope", "id").status_code == 404
    assert get(client, "public.orders", "nope").status_code == 404
