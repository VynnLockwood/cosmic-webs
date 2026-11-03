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
        registry.data_source = "live"
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
    registry.data_source = "mock"
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


@router.get("/relations/suggest")
def suggest_relations():
    """Relations the schema does not declare, with evidence from the rows when they are real."""
    from .relations import suggest

    use_data = registry.data_source in ("dump", "live")
    with registry.session() as conn:
        found = suggest(conn, registry.active_graph(), use_data)
    return {"data_source": registry.data_source, "suggestions": [s.model_dump() for s in found]}


MAX_VALUES = 200


def _like_escape(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/tables/{table:path}/columns/{column}/values")
def column_values(table: str, column: str, q: str = "", limit: int = Query(50, ge=1)):
    """Distinct values of a column, most frequent first, optionally filtered by text (autocomplete for conditions)."""
    t = next((x for x in registry.active_graph().tables if x.name == table), None)
    col = next((c for c in t.columns if c.name == column), None) if t else None
    if t is None or col is None:
        raise HTTPException(404, f"unknown column {table}.{column}")
    limit = min(limit, MAX_VALUES)
    expr = sql.SQL("{}::text").format(sql.Identifier(column)) if col.type in ("json", "xml") else sql.Identifier(column)
    where = sql.SQL("{} is not null").format(sql.Identifier(column))
    params: list = []
    if q:
        where = sql.SQL("{} and {}::text ilike %s escape '\\'").format(where, sql.Identifier(column))
        params.append(f"%{_like_escape(q)}%")
    query = sql.SQL("select {e}, count(*) from {t} where {w} group by 1 order by 2 desc, 1 limit %s").format(e=expr, t=ident(table), w=where)
    try:
        with registry.session() as conn:
            rows = conn.execute(query, (*params, limit + 1)).fetchall()
    except psycopg.Error:
        rows = []  # unreadable column (permission, unsupported type): no suggestions rather than an error
    return jsonable_encoder({"values": [{"value": v, "count": n} for v, n in rows[:limit]], "truncated": len(rows) > limit})
