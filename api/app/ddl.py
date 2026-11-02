"""Parse Postgres DDL into a SchemaGraph using pglast."""
from pglast import ast, parse_sql
from pglast.enums import AlterTableType, ConstrType
from pglast.parser import ParseError

from .models import Column, Fk, FkEnd, ParseResult, SchemaGraph, Table

SILENT = (ast.CreateEnumStmt, ast.CreateSchemaStmt, ast.IndexStmt, ast.CreateExtensionStmt, ast.CommentStmt)
TYPE_ALIASES = {"serial": "int4", "bigserial": "int8", "smallserial": "int2"}


class DdlError(Exception):
    def __init__(self, message: str, line: int = 1, col: int = 1):
        super().__init__(message)
        self.message, self.line, self.col = message, line, col


def _qname(rel: ast.RangeVar) -> str:
    return f"{rel.schemaname or 'public'}.{rel.relname}"


def _strs(nodes) -> list[str]:
    return [n.sval for n in (nodes or ())]


def _type_name(tn: ast.TypeName) -> str:
    last = tn.names[-1].sval
    return TYPE_ALIASES.get(last, last)


def parse_ddl(sql: str) -> ParseResult:
    try:
        stmts = parse_sql(sql)
    except ParseError as e:
        loc = e.args[1] if len(e.args) > 1 and isinstance(e.args[1], int) else 0
        line = sql.count("\n", 0, loc) + 1
        col = loc - (sql.rfind("\n", 0, loc) + 1) + 1
        raise DdlError(str(e.args[0]) if e.args else "syntax error", line, col) from e

    tables: dict[str, Table] = {}
    pks: dict[str, list[str]] = {}
    pending: list[tuple[str, str | None, list[str], str, list[str]]] = []  # table, conname, from cols, to table, to cols
    warnings: list[str] = []

    def add_constraint(tname: str, c: ast.Constraint, colname: str | None = None):
        if c.contype == ConstrType.CONSTR_PRIMARY:
            keys = _strs(c.keys) or ([colname] if colname else [])
            pks[tname] = keys
        elif c.contype == ConstrType.CONSTR_FOREIGN:
            frm = _strs(c.fk_attrs) or ([colname] if colname else [])
            pending.append((tname, c.conname, frm, _qname(c.pktable), _strs(c.pk_attrs)))

    for raw in stmts:
        s = raw.stmt
        if isinstance(s, ast.CreateStmt):
            tname = _qname(s.relation)
            cols: list[Column] = []
            notnull: set[str] = set()
            for el in s.tableElts or ():
                if isinstance(el, ast.ColumnDef):
                    nn = bool(getattr(el, "is_not_null", False))
                    for c in el.constraints or ():
                        if c.contype == ConstrType.CONSTR_NOTNULL:
                            nn = True
                        elif c.contype == ConstrType.CONSTR_PRIMARY:
                            nn = True
                    cols.append(Column(name=el.colname, type=_type_name(el.typeName), nullable=not nn, pk=False))
                    for c in el.constraints or ():
                        add_constraint(tname, c, el.colname)
                elif isinstance(el, ast.Constraint):
                    add_constraint(tname, el)
            tables[tname] = Table(name=tname, columns=cols)
        elif isinstance(s, ast.AlterTableStmt):
            for cmd in s.cmds or ():
                if cmd.subtype == AlterTableType.AT_AddConstraint:
                    add_constraint(_qname(s.relation), cmd.def_)
        elif isinstance(s, SILENT):
            continue
        else:
            warnings.append(f"skipped unsupported statement: {type(s).__name__}")

    if not tables:
        raise DdlError("no tables found")

    for tname, keys in pks.items():
        t = tables.get(tname)
        if t:
            for c in t.columns:
                if c.name in keys:
                    c.pk, c.nullable = True, False

    fks: list[Fk] = []
    used: set[str] = set()
    for tname, conname, frm, to_t, to_cols in pending:
        if to_t not in tables:
            warnings.append(f"foreign key on {tname} references unknown table {to_t}")
            continue
        if not to_cols:
            to_cols = pks.get(to_t, [])
        base = conname or f"fk_{tname.split('.', 1)[1]}_{'_'.join(frm)}"
        fid, n = base, 1
        while fid in used:
            n += 1
            fid = f"{base}_{n}"
        used.add(fid)
        fks.append(Fk(id=fid, **{"from": FkEnd(table=tname, columns=frm)}, to=FkEnd(table=to_t, columns=to_cols)))

    return ParseResult(graph=SchemaGraph(tables=list(tables.values()), fks=fks), warnings=warnings)
