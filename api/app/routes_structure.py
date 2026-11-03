from typing import Literal

import psycopg
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import routes_schema
from .sandbox import admin_conn, refill_sandbox
from .sources import registry
from .structure import ApplyIn, StructureError, apply_ops, state

router = APIRouter(prefix="/api")
MAX_ROWS = 100_000


def _sandbox_only() -> None:
    if registry.mode != "sandbox":
        raise HTTPException(409, "Structure editing only works on the sandbox, never on a live database.")


def _after_change(graph) -> None:
    registry.graph = graph
    routes_schema.invalidate_default()


@router.get("/structure")
def get_structure():
    _sandbox_only()
    with admin_conn() as conn:
        return state(conn)


@router.post("/structure/apply")
def apply_structure(body: ApplyIn):
    _sandbox_only()
    try:
        with admin_conn() as conn:
            executed = apply_ops(conn, body.ops)
            out = state(conn)
    except StructureError as e:
        return JSONResponse(status_code=400, content={"message": str(e)})
    except psycopg.Error as e:
        return JSONResponse(status_code=400, content={"message": str(e).strip().splitlines()[0]})
    from .models import SchemaGraph

    _after_change(SchemaGraph.model_validate(out["graph"]))
    return {**out, "executed": executed}


class RefillIn(BaseModel):
    rows_per_table: int = Field(ge=1, le=MAX_ROWS)


@router.post("/sandbox/refill")
def refill(body: RefillIn):
    _sandbox_only()
    graph = refill_sandbox(body.rows_per_table)
    registry.data_source = "mock"
    _after_change(graph)
    with admin_conn() as conn:
        return {**state(conn), "graph": graph.model_dump(by_alias=True)}


def _pg_dump() -> str | None:
    import glob
    import shutil

    found = shutil.which("pg_dump")
    if found:
        return found
    candidates = sorted(glob.glob("/usr/lib/postgresql/*/bin/pg_dump"), reverse=True)
    return candidates[0] if candidates else None


@router.get("/structure/export")
def export_structure(kind: Literal["schema", "full"] = "schema"):
    """Download the sandbox as a .sql file: its structure (tables, keys, indexes) or structure plus rows."""
    import os
    import subprocess
    import tempfile

    from fastapi.responses import FileResponse
    from starlette.background import BackgroundTask

    _sandbox_only()
    exe = _pg_dump()
    if exe is None:
        return JSONResponse(status_code=501, content={"message": "pg_dump is not installed on the server, so the export is not available."})
    fd, path = tempfile.mkstemp(suffix=".sql")
    os.close(fd)
    args = [exe, "--no-owner", "--no-privileges", "--no-comments", "--file", path, "--dbname", os.environ["SANDBOX_DSN"]]
    if kind == "schema":
        args.insert(1, "--schema-only")
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        os.unlink(path)
        return JSONResponse(status_code=500, content={"message": (done.stderr.strip().splitlines() or ["pg_dump failed"])[-1]})
    name = "cosmic-webs-structure.sql" if kind == "schema" else "cosmic-webs-structure-and-data.sql"
    return FileResponse(path, media_type="text/plain; charset=utf-8", filename=name, background=BackgroundTask(os.unlink, path))
