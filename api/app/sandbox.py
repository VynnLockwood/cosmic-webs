"""Rebuild the sandbox Postgres from user DDL and fill it with mock data."""
import os

import psycopg
from pglast import ast, parse_sql

from .mockdata import fill_mock
from .models import SchemaGraph

READER = "cosmos_ro"
RUNNABLE = (ast.CreateStmt, ast.AlterTableStmt, ast.CreateEnumStmt, ast.CreateSchemaStmt, ast.IndexStmt)


def runnable_statements(ddl: str) -> list[str]:
    """Only schema-building statements are ever executed in the sandbox (no functions, triggers, DML)."""
    out = []
    for raw in parse_sql(ddl):
        if isinstance(raw.stmt, RUNNABLE):
            end = raw.stmt_location + raw.stmt_len if raw.stmt_len else len(ddl)
            out.append(ddl[raw.stmt_location:end])
    return out


def ensure_reader_role(conn) -> None:
    """Unprivileged role used for every session that runs user-supplied SELECTs against the sandbox."""
    conn.execute(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{READER}') then create role {READER} nologin; end if; end $$")


def grant_reader(conn) -> None:
    ensure_reader_role(conn)
    for (schema,) in conn.execute("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'").fetchall():
        conn.execute(f'grant usage on schema "{schema}" to {READER}')
        conn.execute(f'grant select on all tables in schema "{schema}" to {READER}')


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
        grant_reader(conn)
    out = graph.model_copy(deep=True)
    for t in out.tables:
        t.row_estimate = counts.get(t.name, 0)
    return out
