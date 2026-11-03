import * as wasm from "@wasm/cosmos_core.js";
import shop from "../../../samples/shop.graph.json";
import type { SchemaGraph } from "../types";
import { createCoreApi } from "./coreApi";

const graph = shop as SchemaGraph;

test("layout_of_shop_fixture_returns_75_floats", async () => {
  const core = createCoreApi(wasm);
  await core.layoutNew(graph, 1);
  const p = await core.layoutStep(5);
  expect(p).toBeInstanceOf(Float32Array);
  expect(p.length).toBe(25 * 3);
});

test("plan_candidates_returns_array", async () => {
  const core = createCoreApi(wasm);
  const out = await core.planCandidates(graph, { select: ["public.users.email"], where: null, fk_choices: {} });
  expect(Array.isArray(out)).toBe(true);
});

test("step_before_new_throws", async () => {
  await expect(createCoreApi(wasm).layoutStep(1)).rejects.toThrow();
});

test("layoutNew with initial positions keeps them", async () => {
  const core = createCoreApi(wasm);
  const init = new Float32Array(25 * 3).fill(7);
  init[0] = Number.NaN; // first table is "new"
  await core.layoutNew(graph, 1, init);
  const p = await core.layoutStep(0);
  expect(Array.from(p.slice(3, 6))).toEqual([7, 7, 7]);
  expect(Number.isFinite(p[0])).toBe(true);
});
