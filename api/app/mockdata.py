"""FK-valid mock data generation."""
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg
from faker import Faker
from psycopg import sql
from psycopg.types.json import Jsonb

from .models import Fk, SchemaGraph, Table

INT_TYPES = {"int2", "int4", "int8"}


def split_name(name: str) -> tuple[str, str]:
    s, t = name.split(".", 1)
    return s, t


def ident(name: str) -> sql.Composed:
    s, t = split_name(name)
    return sql.SQL(".").join([sql.Identifier(s), sql.Identifier(t)])


def fk_load_order(graph: SchemaGraph) -> tuple[list[str], list[Fk]]:
    """Parents-first table order plus FKs deferred to break cycles and self references."""
    names = sorted(t.name for t in graph.tables)
    deferred: dict[str, Fk] = {f.id: f for f in graph.fks if f.from_.table == f.to.table}
    done: list[str] = []
    remaining = set(names)

    def unresolved(t: str) -> list[Fk]:
        return [f for f in graph.fks if f.from_.table == t and f.id not in deferred and f.to.table in remaining and f.to.table != t]

    while remaining:
        ready = sorted(t for t in remaining if not unresolved(t))
        if not ready:
            pick = min(sorted(remaining), key=lambda t: len(unresolved(t)))
            for f in unresolved(pick):
                deferred[f.id] = f
            ready = [pick]
        for t in ready:
            done.append(t)
            remaining.discard(t)
    return done, list(deferred.values())


class Gen:
    def __init__(self, conn, seed: int):
        self.rnd = random.Random(seed)
        self.fake = Faker()
        self.fake.seed_instance(seed)
        self.limits: dict[tuple[str, str], tuple] = {}
        for sch, tab, col, ml, prec, scale in conn.execute("select table_schema, table_name, column_name, character_maximum_length, numeric_precision, numeric_scale from information_schema.columns where table_schema !~ '^pg_' and table_schema <> 'information_schema'"):
            self.limits[(f"{sch}.{tab}", col)] = (ml, prec, scale)
        self.enums: dict[str, list[str]] = {}
        for typ, label in conn.execute("select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid order by e.enumsortorder"):
            self.enums.setdefault(typ, []).append(label)

    def value(self, name: str, typ: str, i: int, table: str = ""):
        r, f = self.rnd, self.fake
        if typ in self.enums:
            return r.choice(self.enums[typ])
        if typ in INT_TYPES:
            ranges = {"status": (0, 3), "qty": (1, 10), "rating": (1, 5), "percent_off": (5, 50), "quantity": (0, 500)}
            lo, hi = ranges.get(name, (0, 1000))
            return r.randint(lo, hi)
        if typ in ("text", "varchar", "bpchar", "citext"):
            by = {"email": f.email, "contact_email": f.email, "name": f.name, "city": f.city, "country": f.country,
                  "line1": f.street_address, "label": f.word, "code": lambda: f.bothify("????-####").upper(),
                  "body": f.sentence, "reason": f.sentence, "action": f.word, "tracking": f.word}
            v = by.get(name, f.word)()
            return v[:ml] if (ml := self.limits.get((table, name), (None, None, None))[0]) else v
        if typ == "bool":
            return r.random() < 0.5
        if typ in ("numeric", "float4", "float8"):
            _, prec, scale = self.limits.get((table, name), (None, None, None))
            top = 10 ** (prec - scale) - 1 if prec else 500
            return round(r.uniform(0, min(500, top)), scale if scale is not None else 2)
        if typ in ("timestamptz", "timestamp"):
            return datetime.now(timezone.utc) - timedelta(seconds=r.randint(0, 2 * 365 * 86400))
        if typ == "date":
            return date.today() - timedelta(days=r.randint(0, 730))
        if typ == "uuid":
            return uuid.UUID(int=r.getrandbits(128), version=4)
        if typ in ("jsonb", "json"):
            return Jsonb({"k": r.randint(0, 99), "tag": f.word()})
        if typ == "bytea":
            return bytes(r.getrandbits(8) for _ in range(8))
        return f.word()


def fill_mock(conn, graph: SchemaGraph, rows_per_table: int = 1000, seed: int = 0) -> dict[str, int]:
    """Fill every table. FKs are valid; cycle/self FKs are inserted NULL then UPDATEd."""
    order, deferred = fk_load_order(graph)
    dids = {f.id for f in deferred}
    tables = {t.name: t for t in graph.tables}
    gen = Gen(conn, seed)
    rows: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}

    for tname in order:
        t = tables[tname]
        live_fks = [f for f in graph.fks if f.from_.table == tname and f.id not in dids]
        fkcols = {c for f in live_fks for c in f.from_.columns}
        pk = [c.name for c in t.columns if c.pk]
        pk_from_fk = bool(pk) and all(c in fkcols for c in pk)
        parent_tuples = {f.id: [tuple(p[c] for c in f.to.columns) for p in rows[f.to.table]] for f in live_fks}
        out: list[dict] = []
        seen: set[tuple] = set()
        attempts = 0
        while len(out) < rows_per_table and attempts < rows_per_table * 20:
            attempts += 1
            i = len(out)
            row: dict = {}
            for f in live_fks:
                tup = gen.rnd.choice(parent_tuples[f.id]) if parent_tuples[f.id] else None
                for c, v in zip(f.from_.columns, tup or [None] * len(f.from_.columns)):
                    row[c] = v
            for c in t.columns:
                if c.name in row:
                    continue
                if c.pk and len(pk) == 1 and c.type in INT_TYPES:
                    row[c.name] = i + 1
                elif c.name in {x for f in deferred if f.from_.table == tname for x in f.from_.columns}:
                    row[c.name] = None if c.nullable else gen.value(c.name, c.type, i, tname)
                else:
                    row[c.name] = gen.value(c.name, c.type, i, tname)
            if pk_from_fk:
                key = tuple(row[c] for c in pk)
                if key in seen:
                    continue
                seen.add(key)
            out.append(row)
        rows[tname] = out
        if out:
            names = [c.name for c in t.columns]
            q = sql.SQL("insert into {} ({}) values ({})").format(ident(tname), sql.SQL(",").join(map(sql.Identifier, names)), sql.SQL(",").join(sql.Placeholder() * len(names)))
            with conn.cursor() as cur:
                cur.executemany(q, [[r[n] for n in names] for r in out])
        counts[tname] = len(out)

    for f in deferred:
        _backfill(conn, tables, rows, f, gen)

    for t in graph.tables:
        for c in t.columns:
            if c.pk and c.type in INT_TYPES:
                conn.execute(sql.SQL("select setval(pg_get_serial_sequence({}, {}), (select coalesce(max({}),1) from {}))").format(
                    sql.Literal(t.name.replace(".", '"."', 1).join(['"', '"'])), sql.Literal(c.name), sql.Identifier(c.name), ident(t.name)))
    return counts


def _backfill(conn, tables: dict[str, Table], rows, f: Fk, gen: Gen) -> None:
    child, parent = f.from_.table, f.to.table
    pk = [c.name for c in tables[child].columns if c.pk]
    if not pk or not rows[parent]:
        return
    ptuples = [tuple(p[c] for c in f.to.columns) for p in rows[parent]]
    nullable = all(next(c for c in tables[child].columns if c.name == x).nullable for x in f.from_.columns)
    sets = sql.SQL(",").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in f.from_.columns)
    where = sql.SQL(" and ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in pk)
    q = sql.SQL("update {} set {} where {}").format(ident(child), sets, where)
    params = []
    for idx, row in enumerate(rows[child]):
        if child == parent:  # self reference: point at an earlier row; first row stays NULL
            if idx == 0 and nullable:
                continue
            tup = ptuples[gen.rnd.randrange(0, idx)] if idx > 0 else ptuples[0]
        else:
            tup = gen.rnd.choice(ptuples)
        params.append([*tup, *[row[c] for c in pk]])
    with conn.cursor() as cur:
        cur.executemany(q, params)
