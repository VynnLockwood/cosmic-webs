import { ranked } from "../testing/fixtures";
import type { Candidate, Experiment, Metric, Ranked, SchemaGraph, SearchRequest } from "../types";
import { applyStructure, deltaPct, describeOp, experimentFrom, refillData } from "./structureActions";
import { useStore } from "./useStore";

const graph: SchemaGraph = { tables: [{ name: "public.orders", columns: [], row_estimate: 10 }], fks: [] };
const req: SearchRequest = { select: ["public.orders.id"], where: null, fk_choices: {} };
const m = (value: number): Metric => ({ value, best: value, worst: value, norm: 0, weight: 0.5, points: 0 });
const best = (id: string, value: number, metric: "cost" | "time" = "cost"): Ranked => ranked(id, { metric, compared: 3, detail: { cost: m(value), queries: m(1), joins: m(0), rows: m(1) } });
const cand = (id: string): Candidate => ({ id, shape: "Join", fk_ids: [], tables: [], queries: [{ sql: `select ${id}`, params: [] }], joins: 0, query_count: 1 });

beforeEach(() => {
  useStore.setState({ graph, searchRequest: null, results: [], candidates: [], flags: [], experiments: [], indexes: [], structureError: null, structureBusy: false });
});

function fakes(values: number[]) {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    api: {
      getStructure: async () => ({ graph, indexes: [] }),
      applyStructure: async (ops: any) => (calls.push("apply:" + ops[0].kind), { graph: { ...graph, tables: [...graph.tables] }, indexes: [{ schema: "public", table: "public.orders", name: "ix", columns: ["a"], unique: false, primary: false, definition: "" }], executed: ["CREATE INDEX ix"] }),
      refill: async (n: number) => (calls.push("refill:" + n), { graph, indexes: [] }),
    },
    search: async () => (calls.push("search"), { ranked: [best("c1", values[i++])], candidates: [cand("c1")], flags: [], costs: {}, splitHidden: 0 }),
  };
}

test("describeOp gives short readable labels", () => {
  expect(describeOp({ kind: "create_index", table: "public.orders", columns: ["user_id"] })).toBe("+ index orders(user_id)");
  expect(describeOp({ kind: "drop_index", schema: "public", name: "ix" })).toBe("− index ix");
  expect(describeOp({ kind: "add_fk", table: "public.orders", columns: ["u"], ref_table: "public.users", ref_columns: ["id"] })).toBe("+ FK orders(u) → users(id)");
});

test("experimentFrom takes the best plan's value, shape and SQL", () => {
  const e = experimentFrom(3, "x", { ranked: [best("c1", 12.5)], candidates: [cand("c1")], flags: [] });
  expect(e).toMatchObject({ id: 3, label: "x", plans: 3, best: { id: "c1", value: 12.5, metric: "cost", shape: "Join", sql: "select c1" } });
  expect(experimentFrom(0, "none", { ranked: [], candidates: [], flags: [] }).best).toBeNull();
});

test("deltaPct compares like with like only", () => {
  const e = (value: number, metric: "cost" | "time" = "cost") => experimentFrom(0, "", { ranked: [best("c1", value, metric)], candidates: [cand("c1")], flags: [] });
  expect(deltaPct(e(100), e(25))).toBeCloseTo(-75);
  expect(deltaPct(e(100), e(150))).toBeCloseTo(50);
  expect(deltaPct(e(100, "cost"), e(5, "time"))).toBeNull();
  expect(deltaPct(undefined, e(5))).toBeNull();
});

test("applyStructure records the baseline first, applies, re-runs the search and records the change", async () => {
  useStore.setState({ searchRequest: req, results: [best("c1", 100)], candidates: [cand("c1")], flags: [] });
  const d = fakes([20]);
  const ok = await applyStructure([{ kind: "create_index", table: "public.orders", columns: ["a"] }], d as any);
  expect(ok).toBe(true);
  expect(d.calls).toEqual(["apply:create_index", "search"]);
  const s = useStore.getState();
  expect(s.experiments.map((e: Experiment) => [e.label, e.best?.value])).toEqual([["Baseline (before any change)", 100], ["+ index orders(a)", 20]]);
  expect(s.searchRequest).toEqual(req); // the search survives the graph change
  expect(s.keepView).toBe(true);
  expect(s.indexes).toHaveLength(1);
  expect(s.lastExecuted).toEqual(["CREATE INDEX ix"]);
  expect(s.structureBusy).toBe(false);
});

test("without a search nothing is compared, but the change is still applied", async () => {
  const d = fakes([]);
  expect(await applyStructure([{ kind: "create_index", table: "public.orders", columns: ["a"] }], d as any)).toBe(true);
  expect(d.calls).toEqual(["apply:create_index"]);
  expect(useStore.getState().experiments).toEqual([]);
});

test("an API error is shown and nothing is recorded", async () => {
  useStore.setState({ searchRequest: req, results: [best("c1", 100)], candidates: [cand("c1")] });
  const d = fakes([1]);
  d.api.applyStructure = async () => { throw Object.assign(new Error("x"), { body: { message: "unknown column orders.nope" } }); };
  expect(await applyStructure([{ kind: "create_index", table: "public.orders", columns: ["nope"] }], d as any)).toBe(false);
  const s = useStore.getState();
  expect(s.structureError).toBe("unknown column orders.nope");
  expect(s.experiments).toHaveLength(1); // only the baseline
  expect(s.structureBusy).toBe(false);
});

test("refillData records a data-size experiment", async () => {
  useStore.setState({ searchRequest: req, results: [best("c1", 10)], candidates: [cand("c1")] });
  const d = fakes([500]);
  await refillData(50000, d as any);
  expect(d.calls).toEqual(["refill:50000", "search"]);
  expect(useStore.getState().experiments.at(-1)?.label).toBe("Data: 50,000 rows per table");
});

test("loading a new schema starts a fresh lab", () => {
  useStore.setState({ experiments: [experimentFrom(0, "old", { ranked: [], candidates: [], flags: [] })] });
  useStore.getState().setGraph(graph);
  expect(useStore.getState().experiments).toEqual([]);
});
