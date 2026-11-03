import type { Experiment } from "../types";
import { deltaPct } from "./structureActions";

export interface ChangeEntry { label: string; sql: string[] }

const stmt = (s: string) => (s.trim().endsWith(";") ? s.trim() : `${s.trim()};`);

/** A script of everything run in the structure lab, in order (data refills are noted, they have no SQL). */
export function changeScript(log: ChangeEntry[], now = new Date()): string {
  const head = `-- Cosmic Webs: changes made in the structure lab (${now.toISOString().slice(0, 10)})\n`;
  if (log.length === 0) return `${head}-- no changes yet\n`;
  const body = log.map((e) => (e.sql.length ? `-- ${e.label}\n${e.sql.map(stmt).join("\n")}\n` : `-- ${e.label} (mock rows regenerated; no SQL)\n`));
  return `${head}\n${body.join("\n")}`;
}

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The before/after table as CSV. */
export function experimentsCsv(experiments: Experiment[]): string {
  const base = experiments[0];
  const rows = experiments.map((e, i) => {
    if (!e.best) return [csv(e.label), "none", "", "", ""].join(",");
    const d = i === 0 ? "baseline" : (() => { const p = deltaPct(base, e); return p === null ? "" : String(Math.round(p * 10) / 10); })();
    return [csv(e.label), `${e.best.shape} ${e.best.joins} ${e.best.joins === 1 ? "join" : "joins"}`, e.best.metric, String(e.best.value), d].join(",");
  });
  return ["change,best_plan,metric,value,vs_baseline_pct", ...rows].join("\n") + "\n";
}
