import type { Metric, Ranked } from "../types";
import { rankLines, rankVerdict } from "./explainRank";

const m = (value: number, best: number, worst: number, weight: number): Metric => {
  const norm = worst > best ? (value - best) / (worst - best) : 0;
  return { value, best, worst, norm, weight, points: weight * norm };
};
function plan(id: string, cost: number, queries: number, joins: number, rows: number, metric: "cost" | "time" = "cost"): Ranked {
  const detail = { cost: m(cost, 10, 50, 0.5), queries: m(queries, 1, 2, 0.25), joins: m(joins, 0, 2, 0.15), rows: m(rows, 100, 500, 0.1) };
  const score = detail.cost.points + detail.queries.points + detail.joins.points + detail.rows.points;
  return { id, score, breakdown: { cost: detail.cost.points, queries: detail.queries.points, joins: detail.joins.points, rows: detail.rows.points }, reason: "", metric, compared: 4, detail };
}
const a = plan("a", 10, 1, 1, 100); // cheap, 1 query
const b = plan("b", 30, 1, 0, 300); // dearer
const c = plan("c", 20, 2, 0, 200); // 2 queries

test("rankLines lists the four metrics with points that add up to the score", () => {
  const lines = rankLines(b);
  expect(lines.map((l) => l.key)).toEqual(["cost", "queries", "joins", "rows"]);
  expect(lines[0]).toMatchObject({ label: "Estimated cost (planner)", value: "30.0", best: "10.0", worst: "50.0", weight: 0.5 });
  expect(lines.reduce((s, l) => s + l.points, 0)).toBeCloseTo(b.score, 9);
});

test("measured plans are labelled and formatted in milliseconds", () => {
  const t = plan("t", 3.456, 1, 0, 10, "time");
  expect(rankLines(t)[0]).toMatchObject({ label: "Run time (measured)", value: "3.46 ms" });
});

test("verdict for #1 names the metric it wins on and what it gives back", () => {
  const v = rankVerdict(a, 1, a, c);
  expect(v).toContain("Best score");
  expect(v).toContain("Biggest edge over #2: Queries — 1 vs 2 (−0.25 pts)");
  expect(v).toContain("gives back");
  expect(v).toContain("on Joins");
});

test("verdict for #2 says how far it is behind #1 and why", () => {
  const v = rankVerdict(b, 2, a, c);
  expect(v).toMatch(/^Behind #1 by 0\.\d\d pts, mostly on Estimated cost \(planner\): 30\.0 vs 10\.0\./);
});

test("verdict for a lone plan", () => {
  expect(rankVerdict({ ...a, compared: 1 }, 1, a, undefined)).toMatch(/Only one runnable plan/);
});

test("a dead heat is reported as a tie", () => {
  const twin = { ...a, id: "twin" };
  expect(rankVerdict(a, 1, a, twin)).toMatch(/^Tied with #2/);
});
