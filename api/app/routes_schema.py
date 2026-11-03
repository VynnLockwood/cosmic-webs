import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import psycopg

from .ddl import DdlError, parse_ddl
from .sandbox import rebuild_sandbox_report
from .sources import registry

router = APIRouter(prefix="/api")
SAMPLES = Path(os.environ.get("SAMPLES_DIR", Path(__file__).resolve().parents[2] / "samples"))


class SchemaIn(BaseModel):
    ddl: str
    use_dump_data: bool = True  # load the rows of the file when it has any (otherwise generate mock rows)


def error_response(e: DdlError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"message": e.message, "line": e.line, "col": e.col})


_default_cache: dict | None = None


def invalidate_default() -> None:
    """The sandbox no longer matches samples/shop.sql (structure or data changed)."""
    global _default_cache
    _default_cache = None


def _load(ddl: str, use_dump_data: bool = True) -> dict:
    r = parse_ddl(ddl)
    out = r.model_dump(by_alias=True)
    if os.environ.get("SANDBOX_DSN"):
        try:
            rep = rebuild_sandbox_report(ddl, r.graph, use_dump_data=use_dump_data)
            r.graph = rep.graph
            r.warnings.extend(rep.warnings)
            out["data"] = {"source": rep.data_source, "rows_loaded": rep.rows_loaded, "tables_with_data": rep.tables_with_data, "tables_empty": rep.tables_empty}
            registry.use_sandbox()
            registry.graph = r.graph
            registry.data_source = rep.data_source
        except psycopg.Error as e:
            r.warnings.append(f"sandbox unavailable: {e}")
        out["graph"], out["warnings"] = r.graph.model_dump(by_alias=True), r.warnings
    return out


@router.post("/schema")
def post_schema(body: SchemaIn):
    global _default_cache
    try:
        out = _load(body.ddl, body.use_dump_data)
    except DdlError as e:
        return error_response(e)
    _default_cache = None
    return out


@router.get("/schema/default")
def default_schema():
    global _default_cache
    if _default_cache is None:
        _default_cache = _load((SAMPLES / "shop.sql").read_text())
    return _default_cache
