import type { SchemaGraph } from "../types";

/** One line per table: names, types, keys and links. No rows, no values: this text is all the model ever sees of the database. */
export function tableLine(g: SchemaGraph, tableName: string): string {
  const t = g.tables.find((x) => x.name === tableName)!;
  const fkOf = (c: string) => g.fks.find((f) => f.from.table === t.name && f.from.columns.includes(c));
  const cols = t.columns.map((c) => {
    const fk = fkOf(c.name);
    return `${c.name} ${c.type}${c.pk ? " PK" : ""}${fk ? ` FK→${fk.to.table}.${fk.to.columns[Math.max(0, fk.from.columns.indexOf(c.name))]}` : ""}`;
  });
  return `${t.name}(${cols.join(", ")})`;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 2);

/**
 * The schema as text. When it is bigger than `maxChars` only the tables that look relevant to `goal`
 * (name or column matches) and their foreign-key neighbours are kept.
 */
export function schemaDigest(g: SchemaGraph, goal: string, maxChars = 24_000): { text: string; tables: number; total: number } {
  const all = g.tables.map((t) => t.name);
  const full = all.map((n) => tableLine(g, n));
  if (full.join("\n").length <= maxChars) return { text: full.join("\n"), tables: all.length, total: all.length };
  const ws = new Set(words(goal));
  const score = (n: string) => {
    const t = g.tables.find((x) => x.name === n)!;
    const hay = words(`${n} ${t.columns.map((c) => c.name).join(" ")}`.replace(/([a-z])([A-Z])/g, "$1 $2"));
    return hay.filter((w) => ws.has(w) || [...ws].some((x) => w.includes(x) || x.includes(w))).length;
  };
  const ranked = [...all].sort((a, b) => score(b) - score(a));
  const keep: string[] = [];
  const add = (n: string) => { if (!keep.includes(n)) keep.push(n); };
  let size = 0;
  for (const n of ranked) {
    if (score(n) === 0 && keep.length > 0) break;
    for (const m of [n, ...g.fks.flatMap((f) => (f.from.table === n ? [f.to.table] : f.to.table === n ? [f.from.table] : []))]) {
      const len = tableLine(g, m).length + 1;
      if (!keep.includes(m) && size + len <= maxChars) { add(m); size += len; }
    }
  }
  const text = keep.map((n) => tableLine(g, n)).join("\n");
  return { text, tables: keep.length, total: all.length };
}
