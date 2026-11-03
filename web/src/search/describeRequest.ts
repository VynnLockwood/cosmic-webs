import type { Aggregate, Cond, Flag, SearchRequest } from "../types";

/** A piece of text in the "what you asked" view; `dropped` pieces could not be answered and are struck through. */
export interface Seg { text: string; dropped?: boolean }
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

const short = (c: string) => c.replace(/^public\./, "");
const tableOf = (c: string) => c.slice(0, c.lastIndexOf("."));
const isDropped = (c: string, d: Dropped) => d.tables.has(tableOf(c)) || d.columns.has(c);

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return String(v);
}

function leafText(col: string, cmp: string, value: unknown): string {
  const c = short(col);
  if (cmp === "IS NULL" || cmp === "IS NOT NULL") return `${c} ${cmp}`;
  if (Array.isArray(value)) {
    if (cmp.endsWith("BETWEEN")) return `${c} ${cmp} ${lit(value[0])} AND ${lit(value[1])}`;
    return `${c} ${cmp} (${value.map(lit).join(", ")})`;
  }
  return `${c} ${cmp} ${lit(value)}`;
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
  const col = a.col ? short(a.col) : "";
  switch (a.func) {
    case "COUNT": return a.col ? `COUNT(${col})` : "COUNT(*)";
    case "COUNT_DISTINCT": return `COUNT(DISTINCT ${col})`;
    default: return `${a.func}(${col})`;
  }
}

const join = (parts: Seg[][], sep = ", "): Seg[] => parts.flatMap((p, i) => (i ? [{ text: sep }, ...p] : p));

/** The request exactly as asked, as SQL-like lines; parts that were dropped from the plans are marked. */
export function describeRequest(req: SearchRequest, d: Dropped): Seg[][] {
  const lines: Seg[][] = [];
  const aggs = req.aggregates ?? [];
  const items: Seg[][] = [
    ...req.select.map((c) => [{ text: short(c), dropped: isDropped(c, d) }]),
    ...aggs.map((a): Seg[] => [{ text: aggExpr(a) + (a.alias ? ` AS ${a.alias}` : ""), dropped: !!a.col && isDropped(a.col, d) }]),
  ];
  lines.push([{ text: req.distinct ? "SELECT DISTINCT " : "SELECT " }, ...join(items)]);
  if (req.where) lines.push([{ text: "WHERE " }, ...condText(req.where, false, d).segs]);
  if (req.group_by?.length) lines.push([{ text: "GROUP BY " }, ...join(req.group_by.map((c) => [{ text: short(c), dropped: isDropped(c, d) }]))]);
  if (req.having?.length) {
    lines.push([{ text: "HAVING " }, ...join(req.having.map((h): Seg[] => {
      const a = aggs[h.agg];
      return [{ text: `${a ? aggExpr(a) : "?"} ${h.cmp} ${lit(h.value)}`, dropped: !!a?.col && isDropped(a.col, d) }];
    }), " AND ")]);
  }
  if (req.order_by?.length) {
    lines.push([{ text: "ORDER BY " }, ...join(req.order_by.map((o): Seg[] => {
      const dir = o.dir ?? "ASC";
      if (o.col) return [{ text: `${short(o.col)} ${dir}`, dropped: isDropped(o.col, d) }];
      const a = o.agg !== undefined ? aggs[o.agg] : undefined;
      return [{ text: `${a ? a.alias ?? aggExpr(a) : "?"} ${dir}`, dropped: !!a?.col && isDropped(a.col, d) }];
    }))]);
  }
  if (req.limit !== undefined) lines.push([{ text: `LIMIT ${req.limit}` }]);
  if (req.offset !== undefined) lines.push([{ text: `OFFSET ${req.offset}` }]);
  return lines;
}
