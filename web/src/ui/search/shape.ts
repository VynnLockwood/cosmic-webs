import type { AggFunc, Aggregate, Cmp, Having, OrderBy, SearchRequest } from "../../types";
import { parseValue } from "./searchTree";

/** The result-shaping part of the builder as typed in the panel (numbers are still text). */
export interface ShapeDraft {
  distinct: boolean;
  limit: string;
  offset: string;
  orderBy: { kind: "col" | "agg"; col: string; agg: number; dir: "ASC" | "DESC" }[];
  aggregates: { func: AggFunc; col: string; alias: string }[];
  groupBy: string[];
  having: { agg: number; cmp: Cmp; raw: string }[];
}

export const emptyShape = (): ShapeDraft => ({ distinct: false, limit: "", offset: "", orderBy: [], aggregates: [], groupBy: [], having: [] });
export const AGG_FUNCS: { value: AggFunc; label: string; numeric?: boolean }[] = [
  { value: "COUNT", label: "Count" },
  { value: "COUNT_DISTINCT", label: "Count distinct" },
  { value: "SUM", label: "Sum", numeric: true },
  { value: "AVG", label: "Average", numeric: true },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
];
export const HAVING_CMPS: Cmp[] = ["=", "!=", "<", "<=", ">", ">="];

export const isShaped = (s: ShapeDraft) => s.distinct || s.limit !== "" || s.offset !== "" || s.orderBy.length > 0 || s.aggregates.length > 0 || s.groupBy.length > 0;

/** Display name of an aggregate, as in the sort and having pickers. */
export function aggLabel(a: { func: AggFunc; col: string; alias: string }): string {
  if (a.alias.trim()) return a.alias.trim();
  const name = AGG_FUNCS.find((f) => f.value === a.func)!.label;
  return a.col ? `${name} of ${a.col.replace(/^public\./, "")}` : "Count of rows";
}

const whole = (raw: string, what: string): { n?: number; error?: string } => {
  if (raw.trim() === "") return {};
  return /^\d+$/.test(raw.trim()) && Number.isSafeInteger(Number(raw)) ? { n: Number(raw) } : { error: `${what} must be a whole number, 0 or more` };
};

/** Turn the draft into request fields. Only fields that are set are returned. */
export function shapeToRequest(s: ShapeDraft): { fields: Partial<SearchRequest>; errors: string[] } {
  const errors: string[] = [];
  const f: Partial<SearchRequest> = {};
  if (s.distinct) f.distinct = true;
  const aggs: Aggregate[] = s.aggregates.map((a) => ({ func: a.func, ...(a.col ? { col: a.col } : {}), ...(a.alias.trim() ? { alias: a.alias.trim() } : {}) }));
  if (aggs.length) f.aggregates = aggs;
  if (s.groupBy.length) f.group_by = s.groupBy;
  const having: Having[] = [];
  for (const h of s.having) {
    if (h.agg >= s.aggregates.length) {
      errors.push("Having: pick an aggregate");
      continue;
    }
    const r = parseValue("numeric", h.cmp, h.raw);
    if (!r.ok) errors.push(`Having ${aggLabel(s.aggregates[h.agg])}: ${r.error}`);
    else having.push({ agg: h.agg, cmp: h.cmp, value: r.value });
  }
  if (having.length) f.having = having;
  const order: OrderBy[] = s.orderBy.flatMap((o): OrderBy[] => (o.kind === "agg" ? (o.agg < s.aggregates.length ? [{ agg: o.agg, dir: o.dir }] : []) : o.col ? [{ col: o.col, dir: o.dir }] : []));
  if (order.length) f.order_by = order;
  for (const [key, raw, what] of [["limit", s.limit, "Limit"], ["offset", s.offset, "Offset"]] as const) {
    const r = whole(raw, what);
    if (r.error) errors.push(r.error);
    else if (r.n !== undefined) f[key] = r.n;
  }
  return { fields: f, errors };
}

/** Keep aggregate indexes valid after aggregate `removed` is deleted. */
export function dropAggregate(s: ShapeDraft, removed: number): ShapeDraft {
  const shift = (i: number) => (i > removed ? i - 1 : i);
  return {
    ...s,
    aggregates: s.aggregates.filter((_, i) => i !== removed),
    having: s.having.filter((h) => h.agg !== removed).map((h) => ({ ...h, agg: shift(h.agg) })),
    orderBy: s.orderBy.filter((o) => !(o.kind === "agg" && o.agg === removed)).map((o) => (o.kind === "agg" ? { ...o, agg: shift(o.agg) } : o)),
  };
}
