import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .ddl import DdlError, parse_ddl

router = APIRouter(prefix="/api")
SAMPLES = Path(os.environ.get("SAMPLES_DIR", Path(__file__).resolve().parents[2] / "samples"))


class SchemaIn(BaseModel):
    ddl: str


def error_response(e: DdlError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"message": e.message, "line": e.line, "col": e.col})


@router.post("/schema")
def post_schema(body: SchemaIn):
    try:
        r = parse_ddl(body.ddl)
    except DdlError as e:
        return error_response(e)
    return r.model_dump(by_alias=True)


@router.get("/schema/default")
def default_schema():
    return parse_ddl((SAMPLES / "shop.sql").read_text()).model_dump(by_alias=True)
