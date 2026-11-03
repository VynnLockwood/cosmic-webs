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
TEXT_TYPES = {"text", "varchar", "bpchar", "citext"}
FAKEABLE = INT_TYPES | TEXT_TYPES | {"bool", "numeric", "float4", "float8", "timestamptz", "timestamp", "date", "uuid", "jsonb", "json", "bytea"}


def _b36(n: int) -> str:
    digits, out = "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


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
        self.pool: dict[tuple[str, str], list] = {}
        # single-column primary keys / unique indexes: values there must never repeat
        self.unique: set[tuple[str, str]] = {
            (f"{sch}.{tab}", col)
            for sch, tab, col in conn.execute(
                "select n.nspname, c.relname, a.attname from pg_index ix join pg_class c on c.oid = ix.indrelid "
                "join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum = ix.indkey[0] "
                "where ix.indisunique and ix.indnatts = 1 and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'")
        }
        self.enums: dict[str, list[str]] = {}
        for typ, label in conn.execute("select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid order by e.enumsortorder"):
            self.enums.setdefault(typ, []).append(label)

    def value(self, name: str, typ: str, i: int, table: str = ""):
        r, f = self.rnd, self.fake
        if typ.endswith("[]"):
            return "{}"  # a valid empty array literal for any element type
        if typ in self.enums:
            return r.choice(self.enums[typ])
        if (table, name) in self.unique:
            ml = self.limits.get((table, name), (None, None, None))[0]
            if typ in INT_TYPES:
                return i + 1
            if typ in TEXT_TYPES:
                tag = _b36(i + 1)
                if ml is None or ml >= len(tag) + 6:
                    return f"{self.fake.word()}-{tag}"[:ml] if ml else f"{self.fake.word()}-{tag}"
                return tag[:ml]
        if typ not in FAKEABLE:
            return None  # a type we cannot fake (aclitem, tsvector, …): leave NULL
        if typ in INT_TYPES:
            ranges = {"status": (0, 3), "qty": (1, 10), "rating": (1, 5), "percent_off": (5, 50), "quantity": (0, 500)}
            lo, hi = ranges.get(name, (0, 1000))
            return r.randint(lo, hi)
        if typ in ("text", "varchar", "bpchar", "citext"):
            key = (name, typ)
            if key in self.pool:
                v = r.choice(self.pool[key])
                return v[:ml] if (ml := self.limits.get((table, name), (None, None, None))[0]) else v
            by = {"email": f.email, "contact_email": f.email, "name": f.name, "city": f.city, "country": f.country,
                  "line1": f.street_address, "label": f.word, "code": lambda: f.bothify("????-####").upper(),
                  "body": f.sentence, "reason": f.sentence, "action": f.word, "tracking": f.word}
            fn = by.get(name, f.word)
            self.pool[key] = [fn() for _ in range(400)]  # Faker is slow: draw from a pool of 400 per column kind
            v = r.choice(self.pool[key])
            return v[:ml] if (ml := self.limits.get((table, name), (None, None, None))[0]) else v
        if typ == "bool":
            return r.random() < 0.5
        if typ in ("numeric", "float4", "float8"):
            _, prec, scale = self.limits.get((table, name), (None, None, None))
            if typ != "numeric" or prec is None or scale is None:  # floats (and unconstrained numeric) have no precision limit
                return round(r.uniform(0, 500), 2)
            return round(r.uniform(0, min(500, 10 ** (prec - scale) - 1)), scale)
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


def fill_mock(conn, graph: SchemaGraph, rows_per_table: int = 1000, seed: int = 0, warnings: list[str] | None = None, progress=None) -> dict[str, int]:
    """Fill every table. FKs are valid; cycle/self FKs are inserted NULL then UPDATEd."""
    order, deferred = fk_load_order(graph)
    dids = {f.id for f in deferred}
    tables = {t.name: t for t in graph.tables}
    gen = Gen(conn, seed)
    rows: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}

    for n, tname in enumerate(order):
        if progress:
            progress("Loading rows", n / max(len(order), 1), tname)
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
            q = sql.SQL("COPY {} ({}) FROM STDIN").format(ident(tname), sql.SQL(",").join(map(sql.Identifier, names)))
            try:
                with conn.transaction():  # a savepoint: one table failing must not abort the others
                    with conn.cursor() as cur, cur.copy(q) as cp:
                        for r in out:
                            cp.write_row([r[n] for n in names])
            except psycopg.Error as e:
                if warnings is not None:
                    warnings.append(f"{tname}: mock rows not loaded ({str(e).strip().splitlines()[0]})")
                out = []
                rows[tname] = out
        counts[tname] = len(out)

    for f in deferred:
        try:
            with conn.transaction():
                _backfill(conn, tables, rows, f, gen)
        except psycopg.Error as e:
            if warnings is not None:
                warnings.append(f"{f.from_.table}: could not link {f.id} ({str(e).strip().splitlines()[0]})")

    for t in graph.tables:
        for c in t.columns:
            if c.pk and c.type in INT_TYPES:
                conn.execute(sql.SQL("select setval(pg_get_serial_sequence({}, {}), (select coalesce(max({}),1) from {}))").format(
                    sql.Literal(t.name.replace(".", '"."', 1).join(['"', '"'])), sql.Literal(c.name), sql.Identifier(c.name), ident(t.name)))
    return counts


def _backfill(conn, tables: dict[str, Table], rows, f: Fk, gen: Gen) -> None:
    """Point deferred (cycle / self-reference) FK columns at existing parent rows with one set-based UPDATE.

    Nullable columns keep about 5 % NULLs; NOT NULL columns always get a value.
    """
    child, parent = f.from_.table, f.to.table
    if not rows[parent] or not rows[child]:
        return
    nullable = all(next(c for c in tables[child].columns if c.name == x).nullable for x in f.from_.columns)
    pcols = sql.SQL(",").join(sql.Identifier(c) for c in f.to.columns)
    sets = sql.SQL(",").join(sql.SQL("{} = parent.{}").format(sql.Identifier(a), sql.Identifier(b)) for a, b in zip(f.from_.columns, f.to.columns))
    keep = sql.SQL("random() >= 0.05") if nullable else sql.SQL("true")
    q = sql.SQL(
        "WITH parent AS (SELECT {pcols}, row_number() OVER () - 1 AS rn FROM {parent}), "
        "pick AS (SELECT c.ctid AS cid, floor(random() * (SELECT count(*) FROM parent))::bigint AS k FROM {child} c) "
        "UPDATE {child} AS c SET {sets} FROM pick JOIN parent ON parent.rn = pick.k WHERE c.ctid = pick.cid AND {keep}"
    ).format(pcols=pcols, parent=ident(parent), child=ident(child), sets=sets, keep=keep)
    conn.execute(q)
