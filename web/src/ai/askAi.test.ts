import { beforeEach, expect, test } from "vitest";
import { useStore } from "../store/useStore";
import { askAi, applyAiAnswer } from "./askAi";
import { parseAiAnswer } from "./parseAnswer";
import type { SchemaGraph } from "../types";

const col = (name: string, type = "int4") => ({ name, type, nullable: false, pk: false });
const graph: SchemaGraph = { tables: [{ name: "public.users", row_estimate: 99999, columns: [col("id"), col("name", "text")] }, { name: "public.orders", row_estimate: 5, columns: [col("user_id"), col("total", "numeric")] }], fks: [] };

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ graph, ai: { apiKey: "sk-or-test", model: "openai/test" }, aiSql: [], searchSelect: [], searchDraft: null, searchJoins: [] });
});

const answer = { explanation: "Sum paid per user.", request: { select: ["public.users.name"], aggregates: [{ func: "SUM", col: "public.orders.total", alias: "paid" }], order_by: [{ agg: 0, dir: "DESC" }], limit: 20 }, joins: [{ from: "public.orders.user_id", to: "public.users.id" }], sql: [{ title: "left", sql: "SELECT u.name FROM public.users u LEFT JOIN public.orders o ON o.user_id = u.id" }] };
const fakeFetch = (seen: { body?: any }) => (async (_u: string, init: RequestInit) => ((seen.body = JSON.parse(init.body as string)), new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] })))) as unknown as typeof fetch;

test("asking sends only schema text and the wish, and returns a checked answer", async () => {
  const seen: { body?: any } = {};
  const a = await askAi("total paid per user, biggest first", graph, useStore.getState().ai, fakeFetch(seen));
  const sent = JSON.stringify(seen.body);
  expect(sent).toContain("public.users(id int4, name text)");
  expect(sent).toContain("total paid per user");
  expect(sent).not.toMatch(/99999/); // no row counts, no data
  expect(a.error).toBeNull();
  expect(a.request?.limit).toBe(20);
});

test("applying an answer fills the builder, the joins and the AI SQL", async () => {
  applyAiAnswer(parseAiAnswer(JSON.stringify(answer), graph));
  const s = useStore.getState();
  expect(s.searchSelect).toEqual(["public.users.name"]);
  expect(s.searchShape.aggregates).toEqual([{ func: "SUM", col: "public.orders.total", alias: "paid" }]);
  expect(s.searchShape.limit).toBe("20");
  expect(s.searchJoins).toEqual([{ from: "public.orders.user_id", to: "public.users.id" }]);
  expect(s.aiSql.map((x) => x.title)).toEqual(["left"]);
});

test("a missing key or model is explained before anything is sent", async () => {
  await expect(askAi("x", graph, { apiKey: "", model: "m" }, (async () => { throw new Error("should not be called"); }) as any)).rejects.toThrow(/API key and model/);
  await expect(askAi("   ", graph, { apiKey: "k", model: "m" })).rejects.toThrow(/Describe/);
});
