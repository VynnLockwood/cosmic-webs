import { changeScript, experimentsCsv } from "./exportScripts";
import type { Experiment } from "../types";

test("the change script lists every statement run in the lab, in order, each ending with a semicolon", () => {
  const out = changeScript([
    { label: "Add index on orders(total)", sql: ['CREATE INDEX "orders_total_idx" ON "public"."orders" ("total")'] },
    { label: "Data: 50,000 rows per table", sql: [] },
    { label: "Add column x", sql: ["ALTER TABLE a ADD COLUMN x int;"] },
  ], new Date("2026-11-03T10:00:00Z"));
  expect(out).toContain("-- Cosmic Webs: changes made in the structure lab (2026-11-03)");
  expect(out).toContain('-- Add index on orders(total)\nCREATE INDEX "orders_total_idx" ON "public"."orders" ("total");');
  expect(out).toContain("-- Data: 50,000 rows per table (mock rows regenerated; no SQL)");
  expect(out).toContain("-- Add column x\nALTER TABLE a ADD COLUMN x int;\n"); // no double semicolon
  expect(out.indexOf("orders_total_idx")).toBeLessThan(out.indexOf("ADD COLUMN x"));
});

test("an empty log still gives a readable file", () => {
  expect(changeScript([], new Date("2026-11-03T10:00:00Z"))).toContain("no changes yet");
});

const ex = (id: number, label: string, value: number | null): Experiment => ({ id, label, plans: 2, flags: 0, best: value === null ? null : { id: "c1", shape: "Join", joins: 1, queries: 1, value, metric: "time", score: 0, sql: "SELECT 1" } });

test("experiments export as CSV with quoting and a change-vs-baseline column", () => {
  const csv = experimentsCsv([ex(0, "Baseline", 10), ex(1, 'Add "idx", fast', 5), ex(2, "none", null)]);
  const rows = csv.trim().split("\n");
  expect(rows[0]).toBe("change,best_plan,metric,value,vs_baseline_pct");
  expect(rows[1]).toBe("Baseline,Join 1 join,time,10,baseline");
  expect(rows[2]).toBe('"Add ""idx"", fast",Join 1 join,time,5,-50');
  expect(rows[3]).toBe("none,none,,,");
});
