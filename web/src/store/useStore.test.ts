import { useStore } from "./useStore";
import shop from "../../../samples/shop.graph.json";
import type { SchemaGraph } from "../types";

test("setGraph_resets_selection_and_results", () => {
  const s = useStore.getState();
  s.selectTable("public.users");
  s.setResults([{ id: "c1", score: 0, breakdown: { cost: 0, joins: 0, queries: 0, rows: 0 }, reason: "x" }], []);
  s.setGraph(shop as SchemaGraph);
  const n = useStore.getState();
  expect(n.selectedTable).toBeNull();
  expect(n.results).toEqual([]);
  expect(n.graph?.tables.length).toBe(25);
});
