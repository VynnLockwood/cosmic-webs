"""Suggest relations the schema does not declare.

Many real databases have few (or no) FOREIGN KEY constraints. A column named like another table (`sppProject`,
`customer_id`) that holds that table's key is almost certainly a relation; when the rows are real we check it.
"""
from pydantic import BaseModel
from psycopg import sql

from .mockdata import ident
from .models import SchemaGraph

INT_FAMILY = {"int2", "int4", "int8"}
SAMPLE = 20_000  # rows of the child column examined per candidate
CONTRADICTED_BELOW = 0.5  # fewer matching values than this: the name is a coincidence


class Candidate(BaseModel):
    from_table: str
    from_columns: list[str]
    to_table: str
    to_columns: list[str]
    reason: str


class Suggestion(Candidate):
    id: str
    checked: int | None = None  # non-null values examined
    matched: int | None = None  # ...that exist in the referenced key
    verified: bool = False  # every examined value exists in the referenced key


def _variants(col: str) -> list[str]:
    k = col.lower()
    keys = [k]
    for suf in ("_id", "id"):
        if k.endswith(suf) and len(k) > len(suf):
            keys.append(k[: -len(suf)].rstrip("_"))
    more = []
    for v in keys:
        more += [v + "s", v + "es"] + ([v[:-1] + "ies"] if v.endswith("y") else [])
    return list(dict.fromkeys(keys + more))


def _compatible(a: str, b: str) -> bool:
    return a == b or (a in INT_FAMILY and b in INT_FAMILY)


def name_candidates(graph: SchemaGraph) -> list[Candidate]:
    """Columns whose name points at another table with a single-column key of the same type (declared FKs excluded)."""
    by_name: dict[str, list] = {}
    for t in graph.tables:
        by_name.setdefault(t.name.split(".", 1)[1].lower(), []).append(t)
    declared = {(f.from_.table, c) for f in graph.fks for c in f.from_.columns}
    out: list[Candidate] = []
    for child in graph.tables:
        for col in child.columns:
            if col.name.lower() == "id" or (child.name, col.name) in declared:
                continue
            seen: set[str] = set()
            for key in _variants(col.name):
                for parent in by_name.get(key, []):
                    pk = [c for c in parent.columns if c.pk]
                    if parent.name == child.name or parent.name in seen or len(pk) != 1 or not _compatible(col.type, pk[0].type):
                        continue
                    seen.add(parent.name)
                    out.append(Candidate(from_table=child.name, from_columns=[col.name], to_table=parent.name, to_columns=[pk[0].name],
                                         reason=f"column “{col.name}” is named like table “{parent.name.split('.', 1)[1]}”"))
    return out


def suggest(conn, graph: SchemaGraph, use_data: bool) -> list[Suggestion]:
    """Name candidates, checked against the rows when `use_data` (real data only: generated rows prove nothing)."""
    result: list[Suggestion] = []
    for c in name_candidates(graph):
        s = Suggestion(**c.model_dump(), id=f"{c.from_table}.{c.from_columns[0]}->{c.to_table}")
        if use_data:
            q = sql.SQL(
                "SELECT count(c.v), count(p.k) FROM (SELECT {col} AS v FROM {child} WHERE {col} IS NOT NULL LIMIT {n}) c "
                "LEFT JOIN (SELECT {pk} AS k FROM {parent}) p ON p.k = c.v"
            ).format(col=sql.Identifier(c.from_columns[0]), child=ident(c.from_table), n=sql.Literal(SAMPLE), pk=sql.Identifier(c.to_columns[0]), parent=ident(c.to_table))
            try:
                checked, matched = conn.execute(q).fetchone()
            except Exception:  # permission, timeout: keep the name match, say nothing about the data
                checked, matched = 0, 0
            if checked:
                if matched / checked < CONTRADICTED_BELOW:
                    continue
                s.checked, s.matched = checked, matched
                s.verified = matched == checked
        result.append(s)
    order = lambda s: (0 if s.verified else 1 if s.checked else 2, s.from_table, s.from_columns)  # noqa: E731
    return sorted(result, key=order)
