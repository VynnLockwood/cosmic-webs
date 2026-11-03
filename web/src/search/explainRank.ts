import type { Metric, Ranked } from "../types";

export type MetricKey = "cost" | "queries" | "joins" | "rows";
export const KEYS: MetricKey[] = ["cost", "queries", "joins", "rows"];

export const metricLabel = (k: MetricKey, r: Ranked) =>
  ({ cost: r.metric === "time" ? "Run time (measured)" : "Estimated cost (planner)", queries: "Queries", joins: "Joins", rows: "Rows read (estimate)" })[k];

export function fmt(k: MetricKey, v: number, r: Ranked): string {
  if (k === "cost") return r.metric === "time" ? `${v.toFixed(2)} ms` : v.toFixed(1);
  if (k === "rows") return Math.round(v).toLocaleString("en-US");
  return String(Math.round(v));
}

export interface RankLine { key: MetricKey; label: string; value: string; best: string; worst: string; weight: number; points: number }

/** The score sheet of one plan: each metric, where it stands, and the points it adds. */
export function rankLines(r: Ranked): RankLine[] {
  return KEYS.map((k) => {
    const m: Metric = r.detail[k];
    return { key: k, label: metricLabel(k, r), value: fmt(k, m.value, r), best: fmt(k, m.best, r), worst: fmt(k, m.worst, r), weight: m.weight, points: m.points };
  });
}

const pts = (n: number) => n.toFixed(2);

/** One sentence on why a plan sits where it does, compared with the winner / the runner-up. */
export function rankVerdict(r: Ranked, position: number, first?: Ranked, next?: Ranked): string {
  if (r.compared <= 1) return "Only one runnable plan was found, so there was nothing to compare it with.";
  if (position === 1 && next) {
    const diff = KEYS.map((k) => ({ k, d: next.detail[k].points - r.detail[k].points }));
    const best = diff.reduce((a, b) => (b.d > a.d ? b : a));
    const worst = diff.reduce((a, b) => (b.d < a.d ? b : a));
    if (best.d < 0.005) return `Tied with #2 on every metric (score ${pts(r.score)}); the plan with fewer queries, then the lower id, goes first.`;
    const edge = `Best score (${pts(r.score)}, lower is better). Biggest edge over #2: ${metricLabel(best.k, r)} — ${fmt(best.k, r.detail[best.k].value, r)} vs ${fmt(best.k, next.detail[best.k].value, r)} (−${pts(best.d)} pts).`;
    return worst.d < -0.005 ? `${edge} It gives back ${pts(-worst.d)} pts on ${metricLabel(worst.k, r)}.` : edge;
  }
  if (first) {
    const diff = KEYS.map((k) => ({ k, d: r.detail[k].points - first.detail[k].points }));
    const top = diff.reduce((a, b) => (b.d > a.d ? b : a));
    const gap = r.score - first.score;
    if (gap < 0.005) return `Level with #1 (score ${pts(r.score)}); placed behind it only by the tie-break.`;
    return `Behind #1 by ${pts(gap)} pts, mostly on ${metricLabel(top.k, r)}: ${fmt(top.k, r.detail[top.k].value, r)} vs ${fmt(top.k, first.detail[top.k].value, r)}.`;
  }
  return `Score ${pts(r.score)} (lower is better).`;
}

export const HOW_IT_WORKS = {
  intro: "Every plan gets a score from 0 (best) to 1 (worst); the lowest score is #1. Four things are compared across all candidate plans, each scaled between the best and the worst plan in that set:",
  weights: [
    ["Run time (measured) or estimated cost", "50 %"],
    ["Number of queries", "25 %"],
    ["Number of joins", "15 %"],
    ["Rows read (planner estimate)", "10 %"],
  ] as const,
  notes: [
    "A score only says how the plans compare with each other, not an absolute speed.",
    "Run time is measured by really running every plan (median of 3 runs after a warm-up) in the sandbox. On a live database only the planner's estimate is used.",
    "Run-time differences under 0.5 ms (or 10 %) count as noise and are ignored.",
    "Split plans return separate result sets instead of one joined table, so they are hidden unless you include them.",
  ],
};
