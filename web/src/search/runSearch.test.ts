import { runSearch } from "./runSearch";
import type { Candidate, ExplainResult, Flag, Ranked, SchemaGraph, SearchRequest } from "../types";

const graph: SchemaGraph = { tables: [], fks: [] };
const req: SearchRequest = { select: ["public.users.email"], where: null, fk_choices: {} };
const cand = (id: string): Candidate => ({ id, shape: "Join", fk_ids: [], tables: [], queries: [{ sql: "select 1", params: [] }], joins: 0, query_count: 1 });
const ranked = (id: string): Ranked => ({ id, score: 0, breakdown: { cost: 0, joins: 0, queries: 0, rows: 0 }, reason: "" });
const flag = (code: Flag["code"], message: string = code): Flag => ({ code, table: null, column: null, message });
const res = (id: string, error: ExplainResult["error"] = null): ExplainResult => ({ id, total_cost: 5, plan_rows: 9, summary: "", error });

function deps(over: Partial<Record<string, any>> = {}) {
  const calls: string[] = [];
  const mk = (name: string, f: (...a: any[]) => any) => (...a: any[]) => (calls.push(name), f(...a));
  return {
    calls,
    core: {
      diagnose: mk("diagnose", async () => over.diagnose ?? []),
      planCandidates: mk("plan", async () => over.plan ?? [cand("c1"), cand("c2")]),
      rank: mk("rank", async () => over.rank ?? [ranked("c1")]),
      rankFlags: mk("rankFlags", async () => over.rankFlags ?? []),
    } as any,
    api: { explain: mk("explain", async () => { if (over.explainThrows) throw new Error("db down"); return { results: over.explain ?? [res("c1"), res("c2")] }; }) } as any,
  };
}

test("calls_in_order", async () => {
  const d = deps();
  await runSearch(req, graph, d);
  expect(d.calls).toEqual(["diagnose", "plan", "explain", "rank", "rankFlags"]);
});

test("top5_at_most", async () => {
  const d = deps({ rank: Array.from({ length: 7 }, (_, i) => ranked(`c${i}`)) });
  expect((await runSearch(req, graph, d)).ranked).toHaveLength(5);
});

test("merges_and_dedupes_flags", async () => {
  const a = flag("UNREACHABLE", "x"), b = flag("TIMEOUT");
  const out = await runSearch(req, graph, deps({ diagnose: [a], rankFlags: [a, b] }));
  expect(out.flags).toEqual([a, b]);
});

test("no_candidates_skips_explain", async () => {
  const d = deps({ plan: [], diagnose: [flag("UNKNOWN_COLUMN")] });
  const out = await runSearch(req, graph, d);
  expect(d.calls).toEqual(["diagnose", "plan"]);
  expect(out.ranked).toEqual([]);
  expect(out.flags).toHaveLength(1);
});

test("all_errors_returns_empty_ranked_with_flags", async () => {
  const d = deps({ explain: [res("c1", { code: "PERMISSION", message: "denied" }), res("c2", { code: "PERMISSION", message: "denied" })], rank: [], rankFlags: [flag("PERMISSION")] });
  const out = await runSearch(req, graph, d);
  expect(out.ranked).toEqual([]);
  expect(out.flags.map((f) => f.code)).toContain("PERMISSION");
});

test("explain_failure_rejects", async () => {
  await expect(runSearch(req, graph, deps({ explainThrows: true }))).rejects.toThrow("db down");
});

test("sql_errors_become_a_flag_with_the_database_message", async () => {
  const d = deps({ explain: [res("c1", { code: "SQL_ERROR", message: "operator does not exist: integer = text" }), res("c2")], rank: [ranked("c2")] });
  let sentCosts: any[] = [];
  d.core.rank = async (_c: any, costs: any[]) => ((sentCosts = costs), [ranked("c2")]);
  const out = await runSearch(req, graph, d);
  expect(sentCosts.find((c) => c.id === "c1").error).toBe("TYPE_MISMATCH");
  expect(out.flags.some((f) => f.message.includes("operator does not exist"))).toBe(true);
});
