#!/usr/bin/env python3
"""Generate a deterministic 500-table / ~1500-FK schema for performance tests.

Writes samples/synthetic500.sql and samples/synthetic500.graph.json (same JSON the API returns).
"""
import json
import random
from pathlib import Path

N, SEED = 500, 7
rnd = random.Random(SEED)
out = Path(__file__).resolve().parents[1] / "samples"
tables, fks, sql = [], [], []
for i in range(N):
    cols = [("id", "int4", True), ("name", "text", False), ("created_at", "timestamptz", False)]
    parents = sorted(rnd.sample(range(i), min(i, rnd.choice([1, 2, 3, 3, 4])))) if i else []
    for p in parents:
        cols.append((f"t{p}_id", "int4", False))
        fks.append({"id": f"fk_t{i}_t{p}", "from": {"table": f"public.t{i}", "columns": [f"t{p}_id"]}, "to": {"table": f"public.t{p}", "columns": ["id"]}})
    tables.append({"name": f"public.t{i}", "columns": [{"name": n, "type": t, "nullable": not pk, "pk": pk} for n, t, pk in cols], "row_estimate": rnd.choice([0, 100, 1000, 20000])})
    body = ", ".join(f"{n} {t}{' PRIMARY KEY' if pk else ''}" for n, t, pk in cols)
    refs = "".join(f", FOREIGN KEY (t{p}_id) REFERENCES t{p}(id)" for p in parents)
    sql.append(f"CREATE TABLE t{i} ({body}{refs});")
(out / "synthetic500.sql").write_text("\n".join(sql) + "\n")
(out / "synthetic500.graph.json").write_text(json.dumps({"tables": tables, "fks": fks}) + "\n")
print(len(tables), "tables", len(fks), "fks")
