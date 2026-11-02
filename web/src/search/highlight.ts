import type { DotState, LinkState } from "../scene/style";
import type { Candidate, Fk, Flag, FkChoices, SchemaGraph, SearchRequest } from "../types";

/** Tables named by the selected columns and the conditions. */
export function requiredTables(req: SearchRequest): string[] {
  const cols = [...req.select];
  const walk = (c: SearchRequest["where"]) => {
    if (!c) return;
    if ("children" in c) c.children.forEach(walk);
    else cols.push(c.col);
  };
  walk(req.where);
  return [...new Set(cols.map((c) => c.slice(0, c.lastIndexOf("."))))];
}

export interface AmbiguousPair { a: string; b: string; key: string; fks: Fk[]; chosen: string | null }

export function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

/** Table pairs around an AMBIGUOUS_FK flag that have several foreign keys. */
export function ambiguousPairs(graph: SchemaGraph, flag: Flag, choices: FkChoices): AmbiguousPair[] {
  if (flag.code !== "AMBIGUOUS_FK" || !flag.table) return [];
  const by = new Map<string, Fk[]>();
  for (const f of graph.fks) {
    if (f.from.table === f.to.table) continue;
    if (f.from.table !== flag.table && f.to.table !== flag.table) continue;
    const other = f.from.table === flag.table ? f.to.table : f.from.table;
    by.set(other, [...(by.get(other) ?? []), f]);
  }
  return [...by]
    .filter(([, fks]) => fks.length > 1)
    .map(([other, fks]) => {
      const key = pairKey(flag.table!, other);
      const ids = fks.map((f) => f.id).sort();
      return { a: flag.table!, b: other, key, fks: [...fks].sort((x, y) => x.id.localeCompare(y.id)), chosen: ids.includes(choices[key]) ? choices[key] : null };
    });
}

/** Visual state of every dot and link for a highlighted plan (or just the required tables). */
export function planOverrides(graph: SchemaGraph, cand: Candidate | null, required: string[], flags: Flag[], choices: FkChoices) {
  const dots: Record<string, DotState> = {};
  const links: Record<string, LinkState> = {};
  const path = new Set(cand?.tables ?? []);
  const req = new Set(required);
  const flagged = new Set(flags.filter((f) => f.code === "UNREACHABLE" && f.table).map((f) => f.table!));
  for (const t of graph.tables) {
    dots[t.name] = flagged.has(t.name) ? "flagged" : req.has(t.name) ? "required" : path.has(t.name) ? "path" : "dimmed";
  }
  for (const id of cand?.fk_ids ?? []) links[id] = "path";
  for (const f of flags) for (const p of ambiguousPairs(graph, f, choices)) if (!p.chosen) for (const fk of p.fks) if (!links[fk.id]) links[fk.id] = "ambiguous";
  return { dots, links };
}
