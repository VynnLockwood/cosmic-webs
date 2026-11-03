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


class JobIn(BaseModel):
    ddl: str | None = None
    use_default: bool = False
    use_dump_data: bool = True


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


@router.post("/schema/jobs")
def start_job(body: JobIn):
    from . import jobs

    if body.use_default:
        ddl = (SAMPLES / "shop.sql").read_text()
    elif body.ddl is not None:
        ddl = body.ddl
    else:
        return JSONResponse(status_code=422, content={"message": "send ddl or use_default", "line": None, "col": None})
    try:
        started = jobs.start(ddl, body.use_dump_data)
    except DdlError as e:
        return error_response(e)
    if started is None:
        return JSONResponse(status_code=409, content={"message": "an import is already running, wait for it to finish"})
    invalidate_default()
    job_id, parsed = started
    return {"job_id": job_id, "graph": parsed.graph.model_dump(by_alias=True), "warnings": parsed.warnings}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    from . import jobs

    j = jobs.get(job_id)
    if j is None:
        return JSONResponse(status_code=404, content={"message": "unknown job"})
    return j
