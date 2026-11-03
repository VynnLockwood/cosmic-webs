"""Read a SchemaGraph from live Postgres catalogs."""
from .models import Column, Fk, FkEnd, SchemaGraph, Table


def introspect(conn, schema: str) -> SchemaGraph:
    tables: dict[int, Table] = {}
    for oid, rel, reltuples in conn.execute(
        "select c.oid, c.relname, c.reltuples::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = %s and c.relkind in ('r','p') order by c.relname", (schema,)):
        tables[oid] = Table(name=f"{schema}.{rel}", columns=[], row_estimate=max(int(reltuples), 0))
    pk: set[tuple[int, int]] = set()
    for oid, keys in conn.execute("select conrelid, conkey from pg_constraint where contype = 'p' and conrelid = any(%s)", (list(tables),)):
        pk |= {(oid, k) for k in keys}
    for oid, num, name, typ, notnull in conn.execute(
        "select a.attrelid, a.attnum, a.attname, t.typname, a.attnotnull from pg_attribute a join pg_type t on t.oid = a.atttypid "
        "where a.attrelid = any(%s) and a.attnum > 0 and not a.attisdropped order by a.attrelid, a.attnum", (list(tables),)):
        tables[oid].columns.append(Column(name=name, type=typ, nullable=not notnull, pk=(oid, num) in pk))
    names = {oid: {} for oid in tables}
    for oid, num, name in conn.execute("select attrelid, attnum, attname from pg_attribute where attrelid = any(%s) and attnum > 0", (list(tables),)):
        names[oid][num] = name
    fks = []
    for conname, src, dst, ck, fk in conn.execute(
        "select conname, conrelid, confrelid, conkey, confkey from pg_constraint where contype = 'f' and conrelid = any(%s) and confrelid = any(%s) order by oid",
        (list(tables), list(tables))):
        fks.append(Fk(id=conname, **{"from": FkEnd(table=tables[src].name, columns=[names[src][k] for k in ck])},
                      to=FkEnd(table=tables[dst].name, columns=[names[dst][k] for k in fk])))
    return SchemaGraph(tables=list(tables.values()), fks=fks)
