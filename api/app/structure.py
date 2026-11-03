"""Sandbox-only structure editing: build safe DDL from structured operations, apply them atomically."""
from typing import Annotated, Literal, Union

from pglast import ast, parse_sql
from pglast.enums import ObjectType
from psycopg import sql
from pydantic import BaseModel, Field

from .introspect import introspect
from .mockdata import ident, split_name
from .models import SchemaGraph
from .sandbox import DDL_ROLE, ensure_ddl_role, grant_reader

ALLOWED_TYPES = {"int4", "int8", "text", "varchar", "bool", "numeric", "timestamptz", "date", "uuid", "jsonb", "float8"}


class StructureError(ValueError):
    pass


class CreateIndex(BaseModel):
    kind: Literal["create_index"]
    table: str
    columns: list[str]
    unique: bool = False


class DropIndex(BaseModel):
    kind: Literal["drop_index"]
    schema_: str = Field("public", alias="schema")
    name: str
    model_config = {"populate_by_name": True}


class AddFk(BaseModel):
    kind: Literal["add_fk"]
    table: str
    columns: list[str]
    ref_table: str
    ref_columns: list[str]
    validate_: bool = Field(False, alias="validate")  # False = NOT VALID: no check of existing rows, still a real FK
    model_config = {"populate_by_name": True}


class DropFk(BaseModel):
    kind: Literal["drop_fk"]
    table: str
    name: str


class AddColumn(BaseModel):
    kind: Literal["add_column"]
    table: str
    name: str
    type: str


class DropColumn(BaseModel):
    kind: Literal["drop_column"]
    table: str
    name: str


class RawSql(BaseModel):
    kind: Literal["sql"]
    statement: str


Op = Annotated[Union[CreateIndex, DropIndex, AddFk, DropFk, AddColumn, DropColumn, RawSql], Field(discriminator="kind")]


class ApplyIn(BaseModel):
    ops: list[Op]


class IndexInfo(BaseModel):
    schema_: str = Field(alias="schema")
    table: str
    name: str
    columns: list[str]
    unique: bool
    primary: bool
    definition: str
    model_config = {"populate_by_name": True}


def list_indexes(conn) -> list[IndexInfo]:
    rows = conn.execute(
        """select n.nspname, c.relname, i.relname, ix.indisunique, ix.indisprimary,
                  array(select a.attname from unnest(ix.indkey) with ordinality k(attnum, ord)
                        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum order by k.ord),
                  pg_get_indexdef(ix.indexrelid)
           from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class c on c.oid = ix.indrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and c.relkind in ('r','p')
           order by n.nspname, c.relname, i.relname"""
    ).fetchall()
    return [IndexInfo(schema=n, table=f"{n}.{t}", name=i, columns=cols, unique=u, primary=p, definition=d) for n, t, i, u, p, cols, d in rows]


def state(conn) -> dict:
    return {"graph": introspect(conn, None).model_dump(by_alias=True), "indexes": [i.model_dump(by_alias=True) for i in list_indexes(conn)]}


def _table(graph: SchemaGraph, name: str):
    t = next((x for x in graph.tables if x.name == name), None)
    if t is None:
        raise StructureError(f"unknown table {name}")
    return t


def _columns(graph: SchemaGraph, table: str, cols: list[str]) -> list[str]:
    t = _table(graph, table)
    if not cols:
        raise StructureError("pick at least one column")
    have = {c.name for c in t.columns}
    for c in cols:
        if c not in have:
            raise StructureError(f"unknown column {table}.{c}")
    return cols


def _short(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in name)


def _unique_name(base: str, taken: set[str]) -> str:
    base = base[:55]
    n, name = 1, base
    while name in taken:
        n += 1
        name = f"{base}_{n}"
    return name


RAW_OK = (ast.IndexStmt, ast.AlterTableStmt, ast.CreateStmt, ast.CommentStmt)


def _check_raw(statement: str) -> None:
    try:
        stmts = parse_sql(statement)
    except Exception as e:  # pglast ParseError
        raise StructureError(f"invalid SQL: {e.args[0] if e.args else e}") from e
    if len(stmts) != 1:
        raise StructureError("run one statement at a time")
    s = stmts[0].stmt
    if isinstance(s, ast.DropStmt) and s.removeType in (ObjectType.OBJECT_INDEX, ObjectType.OBJECT_TABLE):
        return
    if not isinstance(s, RAW_OK):
        raise StructureError("only CREATE INDEX, ALTER TABLE, CREATE TABLE, DROP INDEX and DROP TABLE are allowed here")


def build(conn, op, graph: SchemaGraph, indexes: list[IndexInfo]) -> sql.Composable | str:
    """Validate one operation against the real structure and return the DDL for it."""
    if isinstance(op, CreateIndex):
        cols = _columns(graph, op.table, op.columns)
        schema, tname = split_name(op.table)
        taken = {i.name for i in indexes if i.schema_ == schema}
        name = _unique_name(f"idx_{_short(tname)}_{'_'.join(_short(c) for c in cols)}", taken)
        return sql.SQL("CREATE {u}INDEX {n} ON {t} ({c})").format(u=sql.SQL("UNIQUE " if op.unique else ""), n=sql.Identifier(name), t=ident(op.table), c=sql.SQL(", ").join(map(sql.Identifier, cols)))
    if isinstance(op, DropIndex):
        ix = next((i for i in indexes if i.schema_ == op.schema_ and i.name == op.name), None)
        if ix is None:
            raise StructureError(f"unknown index {op.schema_}.{op.name}")
        return sql.SQL("DROP INDEX {}").format(sql.SQL(".").join([sql.Identifier(op.schema_), sql.Identifier(op.name)]))
    if isinstance(op, AddFk):
        cols, refs = _columns(graph, op.table, op.columns), _columns(graph, op.ref_table, op.ref_columns)
        if len(cols) != len(refs):
            raise StructureError("the foreign key and referenced column lists must be the same length")
        taken = {f.id for f in graph.fks}
        name = _unique_name(f"fk_{_short(split_name(op.table)[1])}_{'_'.join(_short(c) for c in cols)}", taken)
        return sql.SQL("ALTER TABLE {t} ADD CONSTRAINT {n} FOREIGN KEY ({c}) REFERENCES {rt} ({rc}){nv}").format(
            t=ident(op.table), n=sql.Identifier(name), c=sql.SQL(", ").join(map(sql.Identifier, cols)), rt=ident(op.ref_table),
            rc=sql.SQL(", ").join(map(sql.Identifier, refs)), nv=sql.SQL("" if op.validate_ else " NOT VALID"))
    if isinstance(op, DropFk):
        _table(graph, op.table)
        if not any(f.id == op.name and f.from_.table == op.table for f in graph.fks):
            raise StructureError(f"unknown foreign key {op.name} on {op.table}")
        return sql.SQL("ALTER TABLE {t} DROP CONSTRAINT {n}").format(t=ident(op.table), n=sql.Identifier(op.name))
    if isinstance(op, AddColumn):
        t = _table(graph, op.table)
        if op.type not in ALLOWED_TYPES:
            raise StructureError(f"type must be one of: {', '.join(sorted(ALLOWED_TYPES))}")
        if not op.name.strip() or any(c.name == op.name for c in t.columns):
            raise StructureError("choose a new, non-empty column name")
        return sql.SQL("ALTER TABLE {t} ADD COLUMN {c} {ty}").format(t=ident(op.table), c=sql.Identifier(op.name), ty=sql.SQL(op.type))
    if isinstance(op, DropColumn):
        _columns(graph, op.table, [op.name])
        return sql.SQL("ALTER TABLE {t} DROP COLUMN {c}").format(t=ident(op.table), c=sql.Identifier(op.name))
    if isinstance(op, RawSql):
        _check_raw(op.statement)
        return op.statement
    raise StructureError("unsupported operation")


def apply_ops(conn, ops: list) -> list[str]:
    """Apply all operations in one transaction (all or nothing), then re-grant and re-analyze. Returns the executed SQL."""
    graph = introspect(conn, None)
    ensure_ddl_role(conn)
    for t in graph.tables:  # sandboxes built by an older version were owned by the superuser
        conn.execute(sql.SQL("ALTER TABLE {} OWNER TO {}").format(ident(t.name), sql.Identifier(DDL_ROLE)))
    indexes = list_indexes(conn)
    executed: list[str] = []
    with conn.transaction():
        conn.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(DDL_ROLE)))  # user DDL never runs as superuser
        for op in ops:
            stmt = build(conn, op, graph, indexes)
            executed.append(stmt if isinstance(stmt, str) else stmt.as_string(conn))
            conn.execute(stmt)
            graph, indexes = introspect(conn, None), list_indexes(conn)  # later ops see the result of earlier ones
    grant_reader(conn)
    conn.execute("analyze")
    return executed
