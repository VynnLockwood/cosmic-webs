/** SQL literal for a value (for copy-paste SQL only; plans always run with bind parameters). */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Replace $1, $2 … with literal values so the SQL can be pasted into pgAdmin or psql as it is.
 * Quoted identifiers ("…") are skipped, so a column called "$1" is left alone.
 */
export function inlineParams(sql: string, params: unknown[]): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "$" && /\d/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (/\d/.test(sql[j] ?? "")) j++;
      const n = Number(sql.slice(i + 1, j));
      out += n >= 1 && n <= params.length ? literal(params[n - 1]) : sql.slice(i, j);
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export type SqlMode = "params" | "hardcoded";
/** The SQL of one query in the chosen mode. */
export const sqlFor = (q: { sql: string; params: unknown[] }, mode: SqlMode): string => (mode === "hardcoded" ? inlineParams(q.sql, q.params) : q.sql);
