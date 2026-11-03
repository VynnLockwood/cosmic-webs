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
    _after_change(graph)
    with admin_conn() as conn:
        return {**state(conn), "graph": graph.model_dump(by_alias=True)}
