"""EXPLAIN and run helpers: $n parameter translation, SELECT-only guard, error mapping."""
import re
import statistics

import psycopg
from pglast import ast, parse_sql
from pglast.parser import ParseError

ERROR_CODES = {psycopg.errors.InsufficientPrivilege: "PERMISSION", psycopg.errors.QueryCanceled: "TIMEOUT"}


class NotSelect(ValueError):
    pass


def ensure_select(sql: str) -> None:
    try:
        stmts = parse_sql(sql)
    except ParseError as e:
        raise NotSelect(f"invalid SQL: {e.args[0] if e.args else e}") from e
    if len(stmts) != 1 or not isinstance(stmts[0].stmt, ast.SelectStmt):
        raise NotSelect("only a single SELECT statement is allowed")
    s = stmts[0].stmt
    if s.intoClause is not None or s.lockingClause:
        raise NotSelect("SELECT INTO / FOR UPDATE is not allowed")


def to_driver_sql(sql: str, params: list) -> tuple[str, list]:
    """'$n' placeholders -> '%s' (in order of use); literal '%' is escaped."""
    order: list[int] = []

    def sub(m: re.Match) -> str:
        order.append(int(m.group(1)) - 1)
        return "%s"

    out = re.sub(r"\$(\d+)", sub, sql.replace("%", "%%"))
    return out, [params[i] for i in order]


def classify(e: Exception) -> tuple[str, str]:
    for cls, code in ERROR_CODES.items():
        if isinstance(e, cls):
            return code, str(e).strip()
    return "SQL_ERROR", str(e).strip()


def explain_query(conn, sql: str, params: list, analyze: bool, repeat: int = 3) -> tuple[float, float, str, float | None]:
    """Planner estimate, plus (with analyze) the median measured execution time of `repeat` runs after one warm-up."""
    ensure_select(sql)
    text, vals = to_driver_sql(sql, params)
    prefix = "EXPLAIN (ANALYZE, FORMAT JSON) " if analyze else "EXPLAIN (FORMAT JSON) "
    runs = (max(1, repeat) + 1) if analyze else 1
    times: list[float] = []
    plan = None
    for i in range(runs):
        doc = conn.execute(prefix + text, vals).fetchone()[0][0]
        plan = doc["Plan"]
        if analyze and i > 0:  # run 0 warms caches and is discarded
            times.append(float(doc["Execution Time"]))
    ms = statistics.median(times) if times else None
    return float(plan["Total Cost"]), float(plan["Plan Rows"]), f'{plan["Node Type"]} (cost {plan["Total Cost"]:.1f}, rows {plan["Plan Rows"]})', ms


def run_query(conn, sql: str, params: list, limit: int) -> tuple[list[str], list[list]]:
    ensure_select(sql)
    text, vals = to_driver_sql(sql, params)
    cur = conn.execute(f"SELECT * FROM ({text}) AS q LIMIT %s", [*vals, limit])
    return [d.name for d in cur.description], [list(r) for r in cur.fetchall()]
