"""Regenerate samples/shop.graph.json from samples/shop.sql."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ddl import parse_ddl  # noqa: E402

root = Path(__file__).resolve().parents[2] / "samples"
graph = parse_ddl((root / "shop.sql").read_text()).graph
(root / "shop.graph.json").write_text(json.dumps(graph.model_dump(by_alias=True), indent=2) + "\n")
print(len(graph.tables), "tables", len(graph.fks), "fks")
