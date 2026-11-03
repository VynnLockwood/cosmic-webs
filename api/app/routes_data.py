import psycopg
from fastapi import APIRouter, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg import sql

from .introspect import introspect
from .mockdata import ident
from .sources import LiveParams, registry

router = APIRouter(prefix="/api")
MAX_LIMIT = 200


@router.get("/source")
def get_source():
    return {"mode": registry.mode}


@router.post("/source/live")
def connect_live(p: LiveParams):
    try:
        registry.use_live(p)
        with registry.session() as c:
            registry.graph = introspect(c, p.schema_)
    except psycopg.Error as e:
        registry.use_sandbox()
        msg = str(e).replace(p.password, "***") if p.password else str(e)
        return JSONResponse(status_code=400, content={"message": msg.strip() or "connection failed"})
    return {"graph": registry.graph.model_dump(by_alias=True)}


@router.delete("/source/live")
def disconnect_live():
    registry.use_sandbox()
    registry.graph = None
    return {"mode": registry.mode}


@router.get("/tables/{name:path}/rows")
def table_rows(name: str, limit: int = Query(50, ge=1), offset: int = Query(0, ge=0)):
    table = next((t for t in registry.active_graph().tables if t.name == name), None)
    if table is None:
        raise HTTPException(404, f"unknown table {name}")
    limit = min(limit, MAX_LIMIT)
    pk = [c.name for c in table.columns if c.pk]
    order = sql.SQL(",").join(sql.Identifier(c) for c in pk) if pk else sql.SQL("ctid")
    q = sql.SQL("select * from {} order by {} limit %s offset %s").format(ident(table.name), order)
    with registry.session() as conn:
        cur = conn.execute(q, (limit, offset))
        cols = [d.name for d in cur.description]
        rows = [list(r) for r in cur.fetchall()]
    return jsonable_encoder({"columns": cols, "rows": rows, "total_estimate": table.row_estimate})
