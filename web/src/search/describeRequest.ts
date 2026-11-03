import type { Aggregate, Cond, Flag, SearchRequest } from "../types";
import { literal } from "./sqlText";

/** A piece of text in the "what you asked" view; `dropped` pieces could not be answered and are struck through. */
export interface Seg { text: string; dropped?: boolean; /** an SQL comment line */ note?: boolean }
export interface Dropped { tables: Set<string>; columns: Set<string> }

/** Tables with no foreign-key path and columns that do not exist, from the diagnosis flags. */
export function droppedFrom(flags: Flag[]): Dropped {
  const d: Dropped = { tables: new Set(), columns: new Set() };
  for (const f of flags) {
    if (f.code === "UNREACHABLE" && f.table) d.tables.add(f.table);
    if (f.code === "UNKNOWN_COLUMN" && f.column) d.columns.add(f.column);
  }
  return d;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
/** "public.we.ird" columns: table = everything before the last dot, column = the rest. */
const tableOf = (c: string) => c.slice(0, c.lastIndexOf("."));
const colOf = (c: string) => c.slice(c.lastIndexOf(".") + 1);
const bare = (t: string) => t.slice(t.lastIndexOf(".") + 1);
const qTable = (t: string) => (t.includes(".") ? t.split(".").map(q).join(".") : q(t));
const qCol = (c: string) => `${q(bare(tableOf(c)))}.${q(colOf(c))}`;
const isDropped = (c: string, d: Dropped) => d.tables.has(tableOf(c)) || d.columns.has(c);

function leafText(col: string, cmp: string, value: unknown): string {
  const c = qCol(col);
  if (cmp === "IS NULL" || cmp === "IS NOT NULL") return `${c} ${cmp}`;
  if (Array.isArray(value)) {
    if (cmp.endsWith("BETWEEN")) return `${c} ${cmp} ${literal(value[0])} AND ${literal(value[1])}`;
    return `${c} ${cmp} (${value.map(literal).join(", ")})`;
  }
  return `${c} ${cmp} ${literal(value)}`;
}
/** Plain text of a condition (no marks) and whether every part of it is dropped. */
function condText(c: Cond, nested: boolean, d: Dropped): { text: string; all: boolean; segs: Seg[] } {
  if ("not" in c) {
    const inner = condText(c.not, false, d);
    const text = `NOT (${inner.text})`;
    return inner.all ? { text, all: true, segs: [{ text, dropped: true }] } : { text, all: false, segs: [{ text: "NOT (" }, ...inner.segs, { text: ")" }] };
  }
  if ("children" in c) {
    const kids = c.children.map((k) => condText(k, true, d));
    if (kids.length === 1) return condText(c.children[0], nested, d);
    const sep = ` ${c.op} `;
    const body = kids.map((k) => k.text).join(sep);
    const text = nested ? `(${body})` : body;
    if (kids.every((k) => k.all)) return { text, all: true, segs: [{ text, dropped: true }] };
    const segs: Seg[] = nested ? [{ text: "(" }] : [];
    kids.forEach((k, i) => segs.push(...(i ? [{ text: sep }] : []), ...k.segs));
    if (nested) segs.push({ text: ")" });
    return { text, all: false, segs };
  }
  const text = leafText(c.col, c.cmp, c.value);
  const dropped = isDropped(c.col, d);
  return { text, all: dropped, segs: [{ text, dropped }] };
}

function aggExpr(a: Aggregate): string {
  const col = a.col ? qCol(a.col) : "";
  switch (a.func) {
    case "COUNT": return a.col ? `COUNT(${col})` : "COUNT(*)";
    case "COUNT_DISTINCT": return `COUNT(DISTINCT ${col})`;
    default: return `${a.func}(${col})`;
  }
}

const join = (parts: Seg[][], sep = ", "): Seg[] => parts.flatMap((p, i) => (i ? [{ text: sep }, ...p] : p));

/** The request exactly as asked, as SQL you can paste into Postgres; parts that were dropped from the plans are marked. */
export function describeRequest(req: SearchRequest, d: Dropped): Seg[][] {
  const lines: Seg[][] = [];
  const aggs = req.aggregates ?? [];
  const items: Seg[][] = [
    ...req.select.map((c) => [{ text: qCol(c), dropped: isDropped(c, d) }]),
    ...aggs.map((a): Seg[] => [{ text: aggExpr(a) + (a.alias ? ` AS ${q(a.alias)}` : ""), dropped: !!a.col && isDropped(a.col, d) }]),
  ];
  lines.push([{ text: req.distinct ? "SELECT DISTINCT " : "SELECT " }, ...join(items)]);

  // every table the request touches (a column that does not exist has no table to list)
  const cols = [...req.select, ...(req.group_by ?? []), ...aggs.flatMap((a) => (a.col ? [a.col] : [])), ...(req.order_by ?? []).flatMap((o) => (o.col ? [o.col] : []))];
  const leaves: string[] = [];
  const walk = (c: Cond | null) => { if (!c) return; if ("not" in c) walk(c.not); else if ("children" in c) c.children.forEach(walk); else leaves.push(c.col); };
  walk(req.where);
  const tables = [...new Set([...cols, ...leaves].filter((c) => !d.columns.has(c)).map(tableOf))];
  if (tables.length) {
    lines.push([{ text: "FROM " }, ...join(tables.map((t) => [{ text: qTable(t), dropped: d.tables.has(t) }]))]);
    if (tables.length > 1 && tables.some((t) => d.tables.has(t))) {
      lines.push([{ text: "-- no foreign-key path between these tables, so they are cross-joined: every row pairs with every row", note: true }]);
    }
  }
  if (req.where) lines.push([{ text: "WHERE " }, ...condText(req.where, false, d).segs]);
  if (req.group_by?.length) lines.push([{ text: "GROUP BY " }, ...join(req.group_by.map((c) => [{ text: qCol(c), dropped: isDropped(c, d) }]))]);
  if (req.having?.length) {
    lines.push([{ text: "HAVING " }, ...join(req.having.map((h): Seg[] => {
      const a = aggs[h.agg];
      return [{ text: `${a ? aggExpr(a) : "?"} ${h.cmp} ${literal(h.value)}`, dropped: !!a?.col && isDropped(a.col, d) }];
    }), " AND ")]);
  }
  if (req.order_by?.length) {
    lines.push([{ text: "ORDER BY " }, ...join(req.order_by.map((o): Seg[] => {
      const dir = o.dir ?? "ASC";
      if (o.col) return [{ text: `${qCol(o.col)} ${dir}`, dropped: isDropped(o.col, d) }];
      const a = o.agg !== undefined ? aggs[o.agg] : undefined;
      return [{ text: `${a ? (a.alias ? q(a.alias) : aggExpr(a)) : "?"} ${dir}`, dropped: !!a?.col && isDropped(a.col, d) }];
    }))]);
  }
  if (req.limit !== undefined) lines.push([{ text: `LIMIT ${req.limit}` }]);
  if (req.offset !== undefined) lines.push([{ text: `OFFSET ${req.offset}` }]);
  return lines;
}
