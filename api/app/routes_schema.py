import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import psycopg

from .ddl import DdlError, parse_ddl
from .sandbox import rebuild_sandbox

router = APIRouter(prefix="/api")
SAMPLES = Path(os.environ.get("SAMPLES_DIR", Path(__file__).resolve().parents[2] / "samples"))


class SchemaIn(BaseModel):
    ddl: str


def error_response(e: DdlError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"message": e.message, "line": e.line, "col": e.col})


_default_cache: dict | None = None


def _load(ddl: str) -> dict:
    r = parse_ddl(ddl)
    if os.environ.get("SANDBOX_DSN"):
        try:
            r.graph = rebuild_sandbox(ddl, r.graph)
        except psycopg.Error as e:
            r.warnings.append(f"sandbox unavailable: {e}")
    return r.model_dump(by_alias=True)


@router.post("/schema")
def post_schema(body: SchemaIn):
    global _default_cache
    try:
        out = _load(body.ddl)
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
