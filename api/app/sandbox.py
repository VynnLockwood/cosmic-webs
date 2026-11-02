"""Rebuild the sandbox Postgres from user DDL and fill it with mock data."""
import os

import psycopg
from pglast import ast, parse_sql

from .mockdata import fill_mock
from .models import SchemaGraph

RUNNABLE = (ast.CreateStmt, ast.AlterTableStmt, ast.CreateEnumStmt, ast.CreateSchemaStmt, ast.IndexStmt)


def runnable_statements(ddl: str) -> list[str]:
    """Only schema-building statements are ever executed in the sandbox (no functions, triggers, DML)."""
    out = []
    for raw in parse_sql(ddl):
        if isinstance(raw.stmt, RUNNABLE):
            end = raw.stmt_location + raw.stmt_len if raw.stmt_len else len(ddl)
            out.append(ddl[raw.stmt_location:end])
    return out


def rebuild_sandbox(ddl: str, graph: SchemaGraph, rows_per_table: int = 1000, dsn: str | None = None) -> SchemaGraph:
    dsn = dsn or os.environ["SANDBOX_DSN"]
    with psycopg.connect(dsn, autocommit=True) as conn:
        for (schema,) in conn.execute("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'").fetchall():
            if schema == "public":
                continue
            conn.execute(f'drop schema "{schema}" cascade')
        conn.execute("drop schema public cascade")
        conn.execute("create schema public")
        for stmt in runnable_statements(ddl):
            conn.execute(stmt)
        conn.execute("set session_replication_role = replica")
        with conn.transaction():
            counts = fill_mock(conn, graph, rows_per_table)
        conn.execute("set session_replication_role = origin")
    out = graph.model_copy(deep=True)
    for t in out.tables:
        t.row_estimate = counts.get(t.name, 0)
    return out
