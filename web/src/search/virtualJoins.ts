import type { SchemaGraph } from "../types";

/** A join the user declares for one search: two columns whose values match. Nothing changes in the database. */
export interface VJoin { from: string; to: string }

const split = (c: string) => ({ table: c.slice(0, c.lastIndexOf(".")), column: c.slice(c.lastIndexOf(".") + 1) });
const exists = (g: SchemaGraph, c: string) => {
  const { table, column } = split(c);
  return g.tables.some((t) => t.name === table && t.columns.some((x) => x.name === column));
};

/** One message per join that cannot be used (positions are 1-based, as the user sees them). */
export function joinErrors(g: SchemaGraph, joins: VJoin[]): string[] {
  const out: string[] = [];
  joins.forEach((j, i) => {
    if (!j.from || !j.to) return void out.push(`Join ${i + 1}: pick both columns`);
    const bad = [j.from, j.to].find((c) => !exists(g, c));
    if (bad) return void out.push(`Join ${i + 1}: ${bad} does not exist`);
    if (split(j.from).table === split(j.to).table) out.push(`Join ${i + 1}: the two columns are in the same table`);
  });
  return out;
}

/** The graph plus the valid custom joins as links (the planner treats them like foreign keys). */
export function withJoins(g: SchemaGraph, joins: VJoin[]): SchemaGraph {
  const seen = new Set<string>();
  const fks = [...g.fks];
  joins.forEach((j, i) => {
    if (!j.from || !j.to || !exists(g, j.from) || !exists(g, j.to)) return;
    const a = split(j.from), b = split(j.to);
    if (a.table === b.table) return;
    const key = [j.from, j.to].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    fks.push({ id: `join:${i + 1}`, from: { table: a.table, columns: [a.column] }, to: { table: b.table, columns: [b.column] } });
  });
  return { ...g, fks };
}
