import type { Candidate, Cond, SearchRequest } from "../types";
import type { Draft, EditLeaf } from "../ui/search/draft";
import type { ShapeDraft } from "../ui/search/shape";
import { emptyShape } from "../ui/search/shape";
import type { AiSql } from "./parseAnswer";

/** How a value from the model is written in the builder's text box (the reverse of what Search parses). */
export function rawValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(rawValue).join(",");
  return String(v);
}

function toDraft(c: Cond): Draft {
  if ("not" in c) {
    const inner = toDraft(c.not);
    return "children" in (inner as object) ? { ...(inner as any), not: true } : { op: "AND", not: true, children: [inner] };
  }
  if ("children" in c) return { op: c.op, children: c.children.map(toDraft) };
  const leaf: EditLeaf = { col: c.col, cmp: c.cmp, raw: rawValue(c.value) };
  return leaf;
}

export interface BuilderState { select: string[]; draft: Draft | null; shape: ShapeDraft }

/** Put a validated request into the search builder so the person can see, change and run it. */
export function requestToBuilder(r: SearchRequest): BuilderState {
  const root = r.where ? toDraft(r.where) : null;
  const draft: Draft | null = root && !("children" in (root as object)) ? { op: "AND", children: [root] } : root;
  const shape: ShapeDraft = {
    ...emptyShape(),
    distinct: !!r.distinct,
    limit: r.limit !== undefined ? String(r.limit) : "",
    offset: r.offset !== undefined ? String(r.offset) : "",
    aggregates: (r.aggregates ?? []).map((a) => ({ func: a.func, col: a.col ?? "", alias: a.alias ?? "" })),
    groupBy: r.group_by ?? [],
    having: (r.having ?? []).map((h) => ({ agg: h.agg, cmp: h.cmp, raw: rawValue(h.value) })),
    orderBy: (r.order_by ?? []).map((o) => (o.agg !== undefined ? { kind: "agg" as const, col: "", agg: o.agg, dir: o.dir ?? "ASC" } : { kind: "col" as const, col: o.col ?? "", agg: 0, dir: o.dir ?? "ASC" })),
  };
  return { select: r.select, draft, shape };
}

const joinCount = (sql: string) => (sql.match(/\bjoin\b/gi) ?? []).length;

/** The model's own SQL as candidates that go through EXPLAIN, ranking and Run like the planner's. */
export function sqlCandidates(sqls: AiSql[]): Candidate[] {
  return sqls.map((s, i) => ({
    id: `ai${i + 1}`,
    shape: "Join" as const,
    fk_ids: [],
    tables: [],
    queries: [{ sql: s.sql, params: s.params }],
    joins: joinCount(s.sql),
    query_count: 1,
  }));
}
