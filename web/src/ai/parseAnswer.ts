import type { Aggregate, Cmp, Cond, Having, OrderBy, SchemaGraph, SearchRequest } from "../types";
import { joinErrors, type VJoin } from "../search/virtualJoins";

export interface AiSql { title: string; sql: string; params: unknown[] }
export interface AiAnswer {
  explanation: string;
  request: SearchRequest | null;
  joins: VJoin[];
  sqls: AiSql[];
  warnings: string[];
  error: string | null;
}

const CMPS: Cmp[] = ["=", "!=", "<", "<=", ">", ">=", "IN", "NOT IN", "LIKE", "ILIKE", "NOT LIKE", "NOT ILIKE", "~", "~*", "IS NULL", "IS NOT NULL", "BETWEEN", "NOT BETWEEN"];
const FUNCS = ["COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX"];
const MAX_SQL = 3;

/** The first {...} in the text (models like to wrap JSON in fences or a sentence). */
function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no object");
  return JSON.parse(t.slice(a, b + 1));
}

/** A ";" outside quotes means a second statement (a ";" inside 'text' or "name" is fine). */
export function hasSecondStatement(sql: string): boolean {
  let q: string | null = null;
  for (const ch of sql) {
    if (q) { if (ch === q) q = null; }
    else if (ch === "'" || ch === '"') q = ch;
    else if (ch === ";") return true;
  }
  return false;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

/** Read and check the model's answer against the schema. Anything wrong is dropped and reported, never trusted. */
export function parseAiAnswer(text: string, g: SchemaGraph): AiAnswer {
  const out: AiAnswer = { explanation: "", request: null, joins: [], sqls: [], warnings: [], error: null };
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    out.error = "The model's answer was not valid JSON. Try again, or pick a model that follows instructions better.";
    return out;
  }
  if (!isObj(raw)) {
    out.error = "The model's answer was not valid JSON. Try again, or pick a model that follows instructions better.";
    return out;
  }
  out.explanation = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
  const known = new Set(g.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)));
  const warn = (m: string) => out.warnings.push(m);
  const okCol = (c: unknown, what: string): c is string => {
    if (typeof c === "string" && known.has(c)) return true;
    warn(`${what}: column ${typeof c === "string" ? c : JSON.stringify(c)} does not exist, so it was left out`);
    return false;
  };

  // ---- structured request
  if (isObj(raw.request)) {
    const r = raw.request;
    const req: SearchRequest = { select: [], where: null, fk_choices: {} };
    if (Array.isArray(r.select)) req.select = r.select.filter((c) => okCol(c, "Select"));
    const cond = (c: any): Cond | null => {
      if (!isObj(c)) return null;
      if ("not" in c) { const i = cond(c.not); return i ? { not: i } : null; }
      if (Array.isArray(c.children)) {
        const kids = c.children.map(cond).filter((x: Cond | null): x is Cond => x !== null);
        return kids.length ? { op: String(c.op).toUpperCase() === "OR" ? "OR" : "AND", children: kids } : null;
      }
      if (!okCol(c.col, "Condition")) return null;
      const cmp = String(c.cmp).toUpperCase() as Cmp;
      if (!CMPS.includes(cmp)) { warn(`Condition on ${c.col}: operator ${String(c.cmp)} is not supported, so it was left out`); return null; }
      return c.value === undefined || cmp.startsWith("IS ") ? { col: c.col, cmp } : { col: c.col, cmp, value: c.value };
    };
    req.where = cond(r.where);
    if (r.distinct === true) req.distinct = true;
    if (Array.isArray(r.aggregates)) {
      const keep: { old: number; a: Aggregate }[] = [];
      r.aggregates.forEach((a: any, old: number) => {
        const func = String(a?.func).toUpperCase();
        if (!FUNCS.includes(func)) return void warn(`Aggregate ${String(a?.func)} is not supported, so it was left out`);
        if (a.col !== undefined && !okCol(a.col, "Aggregate")) return;
        keep.push({ old, a: { func: func as Aggregate["func"], ...(a.col ? { col: a.col } : {}), ...(typeof a.alias === "string" && a.alias ? { alias: a.alias } : {}) } });
      });
      if (keep.length) req.aggregates = keep.map((k) => k.a);
      const remap = (i: unknown) => keep.findIndex((k) => k.old === i);
      if (Array.isArray(r.having)) {
        const h = r.having.flatMap((x: any): Having[] => {
          const agg = remap(x?.agg), cmp = String(x?.cmp).toUpperCase() as Cmp;
          return agg >= 0 && CMPS.includes(cmp) ? [{ agg, cmp, value: x.value }] : (warn("A HAVING pointing at a missing aggregate was left out"), []);
        });
        if (h.length) req.having = h;
      }
      if (Array.isArray(r.order_by)) {
        const o = r.order_by.flatMap((x: any): OrderBy[] => {
          const dir = String(x?.dir).toUpperCase() === "DESC" ? "DESC" : "ASC";
          if (x?.agg !== undefined) { const agg = remap(x.agg); return agg >= 0 ? [{ agg, dir }] : []; }
          return okCol(x?.col, "Sort") ? [{ col: x.col, dir }] : [];
        });
        if (o.length) req.order_by = o;
      }
    } else if (Array.isArray(r.order_by)) {
      const o = r.order_by.flatMap((x: any): OrderBy[] => (x?.col !== undefined && okCol(x.col, "Sort") ? [{ col: x.col, dir: String(x.dir).toUpperCase() === "DESC" ? "DESC" : "ASC" }] : []));
      if (o.length) req.order_by = o;
    }
    if (Array.isArray(r.group_by)) { const gb = r.group_by.filter((c: unknown) => okCol(c, "Group by")); if (gb.length) req.group_by = gb; }
    const limit = whole(r.limit), offset = whole(r.offset);
    if (limit !== undefined) req.limit = limit;
    if (offset !== undefined) req.offset = offset;
    if (req.select.length || req.aggregates?.length || req.group_by?.length) out.request = req;
  }

  // ---- custom joins
  if (Array.isArray(raw.joins)) {
    const joins: VJoin[] = raw.joins.filter(isObj).map((j) => ({ from: String(j.from ?? ""), to: String(j.to ?? "") }));
    const errs = joinErrors(g, joins);
    const bad = new Set(errs.map((e) => Number(/^Join (\d+)/.exec(e)![1]) - 1));
    out.joins = joins.filter((_, i) => !bad.has(i));
    errs.forEach((e) => warn(`${e}; it was left out`));
  }

  // ---- full SQL
  if (Array.isArray(raw.sql)) {
    for (const [i, s] of raw.sql.entries()) {
      const title = typeof s?.title === "string" && s.title.trim() ? s.title.trim() : `AI query ${i + 1}`;
      let sql = typeof s?.sql === "string" ? s.sql.trim().replace(/;+\s*$/, "").trim() : "";
      if (!sql) { warn(`"${title}": the SQL was empty`); continue; }
      if (hasSecondStatement(sql)) { warn(`"${title}": several statements are not allowed, so it was left out`); continue; }
      if (!/^(select|with)\b/i.test(sql)) { warn(`"${title}": not read-only (it must start with SELECT or WITH), so it was left out`); continue; }
      if (out.sqls.length >= MAX_SQL) { warn(`Only the first ${MAX_SQL} SQL queries are used`); break; }
      out.sqls.push({ title, sql, params: Array.isArray(s.params) ? s.params : [] });
    }
  }

  if (!out.request && out.sqls.length === 0) out.error = "The answer had nothing usable: " + (out.warnings[0] ?? "no request and no SQL") + ".";
  return out;
}
