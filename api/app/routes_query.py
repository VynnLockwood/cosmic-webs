from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .explain import NotSelect, classify, explain_query, run_query
from .sources import registry

router = APIRouter(prefix="/api")
DEFAULT_LIMIT, MAX_LIMIT = 100, 1000


class SqlQuery(BaseModel):
    sql: str
    params: list = []


class CandidateIn(BaseModel):
    id: str
    queries: list[SqlQuery]


class ExplainIn(BaseModel):
    candidates: list[CandidateIn]
    analyze: bool = False
    repeat: int = 3  # timed runs per query when analyze is on


class RunIn(BaseModel):
    query: SqlQuery
    limit: int = DEFAULT_LIMIT


@router.post("/explain")
def explain(body: ExplainIn):
    if body.analyze and registry.mode == "live" and not (registry.live and registry.live.allow_analyze):
        raise HTTPException(403, "EXPLAIN ANALYZE is disabled for live sources")
    results = []
    with registry.session() as conn:
        for cand in body.candidates:
            cost = rows = 0.0
            ms: float | None = 0.0 if body.analyze else None
            summaries: list[str] = []
            err = None
            for q in cand.queries:
                try:
                    c, r, s, t = explain_query(conn, q.sql, q.params, body.analyze, min(max(body.repeat, 1), 10))
                    cost, rows = cost + c, rows + r
                    if ms is not None and t is not None:
                        ms += t
                    summaries.append(s)
                except NotSelect as e:
                    raise HTTPException(400, str(e)) from e
                except Exception as e:  # driver errors become per-candidate flags
                    code, msg = classify(e)
                    err = {"code": code, "message": msg}
                    break
            results.append({"id": cand.id, "total_cost": 0.0 if err else cost, "plan_rows": 0.0 if err else rows, "exec_ms": None if err else ms, "summary": " + ".join(summaries), "error": err})
    return {"results": results}


@router.post("/run")
def run(body: RunIn):
    limit = max(1, min(body.limit, MAX_LIMIT))
    with registry.session() as conn:
        try:
            cols, rows = run_query(conn, body.query.sql, body.query.params, limit)
        except NotSelect as e:
            raise HTTPException(400, str(e)) from e
        except Exception as e:
            code, msg = classify(e)
            return JSONResponse(status_code=400, content={"code": code, "message": msg})
    flags = [] if rows else [{"code": "EMPTY_RESULT", "table": None, "column": None, "message": "query ran but returned 0 rows"}]
    return jsonable_encoder({"columns": cols, "rows": rows, "row_count": len(rows), "flags": flags})
