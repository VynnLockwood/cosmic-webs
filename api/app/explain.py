"""EXPLAIN and run helpers: $n parameter translation, SELECT-only guard, error mapping."""
import re

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


def explain_query(conn, sql: str, params: list, analyze: bool) -> tuple[float, float, str]:
    ensure_select(sql)
    text, vals = to_driver_sql(sql, params)
    opts = "ANALYZE, FORMAT JSON" if analyze else "FORMAT JSON"
    row = conn.execute(f"EXPLAIN ({opts}) {text}", vals).fetchone()
    plan = row[0][0]["Plan"]
    return float(plan["Total Cost"]), float(plan["Plan Rows"]), f'{plan["Node Type"]} (cost {plan["Total Cost"]:.1f}, rows {plan["Plan Rows"]})'


def run_query(conn, sql: str, params: list, limit: int) -> tuple[list[str], list[list]]:
    ensure_select(sql)
    text, vals = to_driver_sql(sql, params)
    cur = conn.execute(f"SELECT * FROM ({text}) AS q LIMIT %s", [*vals, limit])
    return [d.name for d in cur.description], [list(r) for r in cur.fetchall()]
