"""Rebuild the sandbox Postgres from user DDL and fill it with mock data."""
import os

import psycopg
from pglast import ast
from pglast.enums import AlterTableType
from pglast import parse_sql

from dataclasses import dataclass, field

from .ddl import extract_copy_blocks, strip_psql
from psycopg import sql

from .mockdata import fill_mock, ident
from .models import SchemaGraph

READER = "cosmos_ro"
DDL_ROLE = "cosmos_ddl"  # owns the sandbox objects; unlike the sandbox login it is not a superuser
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


def ensure_ddl_role(conn) -> None:
    """Create the non-superuser role that runs user-supplied DDL (so a column DEFAULT cannot read server files)."""
    conn.execute(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{DDL_ROLE}') then create role {DDL_ROLE} nologin; end if; end $$")
    db = conn.execute("select current_database()").fetchone()[0]
    conn.execute(sql.SQL("grant create on database {} to {}").format(sql.Identifier(db), sql.Identifier(DDL_ROLE)))
    conn.execute(f"grant all on schema public to {DDL_ROLE}")


def grant_reader(conn) -> None:
    ensure_reader_role(conn)
    for (schema,) in conn.execute("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'").fetchall():
        conn.execute(f'grant usage on schema "{schema}" to {READER}')
        conn.execute(f'grant select on all tables in schema "{schema}" to {READER}')


def admin_conn(dsn: str | None = None) -> psycopg.Connection:
    """Superuser connection to the sandbox (schema changes only; never used for user-supplied SELECTs)."""
    return psycopg.connect(dsn or os.environ["SANDBOX_DSN"], autocommit=True)


def refill_sandbox(rows_per_table: int, dsn: str | None = None) -> SchemaGraph:
    """Empty every table and generate `rows_per_table` new mock rows, keeping the structure (indexes, FKs, columns)."""
    from .introspect import introspect

    with admin_conn(dsn) as conn:
        graph = introspect(conn, None)
        if graph.tables:
            names = sql.SQL(", ").join(ident(t.name) for t in graph.tables)
            conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(names))
        conn.execute("set session_replication_role = replica")
        with conn.transaction():
            counts = fill_mock(conn, graph, rows_per_table)
        conn.execute("set session_replication_role = origin")
        conn.execute("analyze")
    for t in graph.tables:
        t.row_estimate = counts.get(t.name, 0)
    return graph


@dataclass
class ImportReport:
    graph: SchemaGraph
    warnings: list[str] = field(default_factory=list)
    data_source: str = "mock"  # "dump": the rows of the file; "mock": generated rows
    rows_loaded: int = 0
    tables_with_data: int = 0
    tables_empty: int = 0


def rebuild_sandbox(ddl: str, graph: SchemaGraph, rows_per_table: int = 1000, dsn: str | None = None) -> SchemaGraph:
    return rebuild_sandbox_report(ddl, graph, rows_per_table, dsn).graph


def _first_line(e: Exception) -> str:
    return (str(e).strip().splitlines() or [type(e).__name__])[0]


def rebuild_sandbox_report(ddl: str, graph: SchemaGraph, rows_per_table: int = 1000, dsn: str | None = None, use_dump_data: bool = True) -> ImportReport:
    """Rebuild the sandbox. Statements or tables that fail are skipped and reported; the sandbox is always left readable.

    If the file carries rows (COPY blocks) they are loaded as they are and empty tables stay empty; otherwise mock rows are generated.
    """
    dsn = dsn or os.environ["SANDBOX_DSN"]
    report = ImportReport(graph=graph)
    warnings = report.warnings
    with psycopg.connect(dsn, autocommit=True) as conn:
        for (schema,) in conn.execute("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'").fetchall():
            if schema == "public":
                continue
            conn.execute(f'drop schema "{schema}" cascade')
        conn.execute("drop schema public cascade")
        conn.execute("create schema public")
        ensure_ddl_role(conn)
        conn.execute(f"set role {DDL_ROLE}")
        try:
            for stmt in runnable_statements(ddl):
                try:
                    conn.execute(stmt)
                except psycopg.Error as e:
                    head = " ".join(stmt.split())[:70]
                    warnings.append(f"skipped ({head}…): {_first_line(e)}")
        finally:
            conn.execute("reset role")
        existing = {f"{s}.{t}" for s, t in conn.execute("select schemaname, tablename from pg_tables where schemaname !~ '^pg_' and schemaname <> 'information_schema'")}
        built = SchemaGraph(
            tables=[t for t in graph.tables if t.name in existing],
            fks=[f for f in graph.fks if f.from_.table in existing and f.to.table in existing],
        )
        blocks = [b for b in extract_copy_blocks(ddl) if b.table in existing] if use_dump_data else []
        conn.execute("set session_replication_role = replica")  # no FK checks while loading
        try:
            if any(b.rows for b in blocks):
                report.data_source = "dump"
                for b in blocks:
                    if not b.rows:
                        continue
                    q = sql.SQL("COPY {} ({}) FROM STDIN").format(ident(b.table), sql.SQL(", ").join(map(sql.Identifier, b.columns)))
                    try:
                        with conn.transaction(), conn.cursor() as cur, cur.copy(q) as cp:
                            cp.write(b.data)
                    except psycopg.Error as e:
                        warnings.append(f"{b.table}: its {b.rows} rows were not loaded ({_first_line(e)})")
            else:
                with conn.transaction():
                    fill_mock(conn, built, rows_per_table, warnings=warnings)
        except psycopg.Error as e:
            warnings.append(f"data not loaded: {_first_line(e)}")
        finally:
            conn.execute("set session_replication_role = origin")
            grant_reader(conn)  # always: otherwise the read-only role cannot see the tables ("permission denied")
            conn.execute("analyze")
        counts = {t.name: conn.execute(sql.SQL("select count(*) from {}").format(ident(t.name))).fetchone()[0] for t in built.tables}
    out = built.model_copy(deep=True)
    for t in out.tables:
        t.row_estimate = counts.get(t.name, 0)
    report.graph = out
    report.rows_loaded = sum(counts.values())
    report.tables_with_data = sum(1 for n in counts.values() if n > 0)
    report.tables_empty = len(counts) - report.tables_with_data
    return report
