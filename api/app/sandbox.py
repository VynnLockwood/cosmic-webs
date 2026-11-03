"""Rebuild the sandbox Postgres from user DDL and fill it with mock data."""
import os

import psycopg
from pglast import ast
from pglast.enums import AlterTableType
from pglast import parse_sql

from .ddl import strip_psql
from .mockdata import fill_mock
from .models import SchemaGraph

READER = "cosmos_ro"
RUNNABLE = (ast.CreateStmt, ast.AlterTableStmt, ast.CreateEnumStmt, ast.CreateSchemaStmt, ast.IndexStmt, ast.CreateSeqStmt, ast.AlterSeqStmt)


def _owner_only(stmt) -> bool:
    return isinstance(stmt, ast.AlterTableStmt) and all(c.subtype == AlterTableType.AT_ChangeOwner for c in stmt.cmds or ())


def runnable_statements(ddl: str) -> list[str]:
    """Only schema-building statements are ever executed in the sandbox (no functions, triggers, DML, OWNER changes)."""
    ddl = strip_psql(ddl)
    out = []
    for raw in parse_sql(ddl):
        if isinstance(raw.stmt, RUNNABLE) and not _owner_only(raw.stmt):
            end = raw.stmt_location + raw.stmt_len if raw.stmt_len else len(ddl)
            out.append(ddl[raw.stmt_location:end].strip())
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
    return rebuild_sandbox_report(ddl, graph, rows_per_table, dsn)[0]


def rebuild_sandbox_report(ddl: str, graph: SchemaGraph, rows_per_table: int = 1000, dsn: str | None = None) -> tuple[SchemaGraph, list[str]]:
    """Rebuild the sandbox. Statements that fail are skipped and reported; the returned graph holds what really exists."""
    dsn = dsn or os.environ["SANDBOX_DSN"]
    warnings: list[str] = []
    with psycopg.connect(dsn, autocommit=True) as conn:
        for (schema,) in conn.execute("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'").fetchall():
            if schema == "public":
                continue
            conn.execute(f'drop schema "{schema}" cascade')
        conn.execute("drop schema public cascade")
        conn.execute("create schema public")
        for stmt in runnable_statements(ddl):
            try:
                conn.execute(stmt)
            except psycopg.Error as e:
                head = " ".join(stmt.split())[:70]
                warnings.append(f"skipped ({head}…): {str(e).strip().splitlines()[0]}")
        existing = {f"{s}.{t}" for s, t in conn.execute("select schemaname, tablename from pg_tables where schemaname !~ '^pg_' and schemaname <> 'information_schema'")}
        built = SchemaGraph(
            tables=[t for t in graph.tables if t.name in existing],
            fks=[f for f in graph.fks if f.from_.table in existing and f.to.table in existing],
        )
        conn.execute("set session_replication_role = replica")
        with conn.transaction():
            counts = fill_mock(conn, built, rows_per_table)
        conn.execute("set session_replication_role = origin")
        grant_reader(conn)
        conn.execute("analyze")
    out = built.model_copy(deep=True)
    for t in out.tables:
        t.row_estimate = counts.get(t.name, 0)
    return out, warnings
