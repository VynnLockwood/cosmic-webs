import type { SchemaGraph } from "../types";
import { hasSecondStatement, parseAiAnswer } from "./parseAnswer";

const col = (name: string, type = "int4") => ({ name, type, nullable: false, pk: false });
const g: SchemaGraph = {
  tables: [
    { name: "public.users", row_estimate: 0, columns: [col("id"), col("name", "text")] },
    { name: "public.orders", row_estimate: 0, columns: [col("id"), col("user_id"), col("total", "numeric")] },
  ],
  fks: [],
};
const wrap = (o: unknown) => JSON.stringify(o);

test("plain JSON, fenced JSON and JSON inside chatter all parse", () => {
  const o = { explanation: "ok", request: { select: ["public.users.name"] } };
  for (const text of [wrap(o), "```json\n" + wrap(o) + "\n```", "Sure! Here you go:\n" + wrap(o) + "\nHope it helps."]) {
    const r = parseAiAnswer(text, g);
    expect(r.error).toBeNull();
    expect(r.request?.select).toEqual(["public.users.name"]);
    expect(r.explanation).toBe("ok");
  }
});

test("not JSON at all gives an error, not a crash", () => {
  expect(parseAiAnswer("I cannot do that.", g).error).toMatch(/not valid JSON/i);
  expect(parseAiAnswer("{broken", g).error).toMatch(/not valid JSON/i);
});

test("unknown columns are dropped and reported; the rest of the request survives", () => {
  const r = parseAiAnswer(wrap({ request: { select: ["public.users.name", "public.users.nope"], where: { op: "AND", children: [{ col: "public.orders.total", cmp: ">", value: 5 }, { col: "public.orders.ghost", cmp: "=", value: 1 }] }, order_by: [{ col: "public.zzz.x" }] } }), g);
  expect(r.request?.select).toEqual(["public.users.name"]);
  expect(r.request?.where).toEqual({ op: "AND", children: [{ col: "public.orders.total", cmp: ">", value: 5 }] });
  expect(r.request?.order_by).toBeUndefined();
  expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining("public.users.nope"), expect.stringContaining("public.orders.ghost"), expect.stringContaining("public.zzz.x")]));
});

test("comparators are checked, case is fixed, NOT and nested groups are kept", () => {
  const r = parseAiAnswer(wrap({ request: { select: ["public.users.id"], where: { not: { op: "or", children: [{ col: "public.users.name", cmp: "ilike", value: "%a%" }, { col: "public.users.name", cmp: "SOUNDS LIKE", value: "x" }] } } } }), g);
  expect(r.request?.where).toEqual({ not: { op: "OR", children: [{ col: "public.users.name", cmp: "ILIKE", value: "%a%" }] } });
  expect(r.warnings.join(" ")).toContain("SOUNDS LIKE");
});

test("aggregates, group by, having, sort and paging are validated", () => {
  const r = parseAiAnswer(wrap({ request: {
    select: ["public.users.name"],
    aggregates: [{ func: "sum", col: "public.orders.total", alias: "paid" }, { func: "MEDIAN", col: "public.orders.total" }, { func: "COUNT" }],
    group_by: ["public.users.name"],
    having: [{ agg: 0, cmp: ">", value: 10 }, { agg: 9, cmp: ">", value: 1 }],
    order_by: [{ agg: 0, dir: "desc" }, { col: "public.users.name", dir: "sideways" }],
    limit: 20.7, offset: -3, distinct: true } }), g);
  expect(r.request).toMatchObject({
    aggregates: [{ func: "SUM", col: "public.orders.total", alias: "paid" }, { func: "COUNT" }],
    group_by: ["public.users.name"],
    having: [{ agg: 0, cmp: ">", value: 10 }],
    order_by: [{ agg: 0, dir: "DESC" }, { col: "public.users.name", dir: "ASC" }],
    limit: 20, distinct: true,
  });
  expect(r.request?.offset).toBeUndefined();
  expect(r.warnings.join(" ")).toMatch(/MEDIAN/);
});

test("custom SQL: only a single read-only SELECT / WITH is kept, semicolons trimmed", () => {
  const r = parseAiAnswer(wrap({ sql: [
    { title: "left", sql: "SELECT u.name FROM public.users u LEFT JOIN public.orders o ON o.user_id = u.id;" },
    { title: "cte", sql: "with x as (select 1) select * from x", params: [1] },
    { title: "bad", sql: "DELETE FROM public.users" },
    { title: "two", sql: "SELECT 1; DROP TABLE users" },
    { title: "empty", sql: "  " },
  ] }), g);
  expect(r.sqls.map((s) => s.title)).toEqual(["left", "cte"]);
  expect(r.sqls[0].sql.endsWith(";")).toBe(false);
  expect(r.sqls[1].params).toEqual([1]);
  expect(r.warnings.filter((w) => /not read-only|several statements|empty/i.test(w))).toHaveLength(3);
});

test("custom joins are validated against the schema", () => {
  const r = parseAiAnswer(wrap({ request: { select: ["public.users.name"] }, joins: [{ from: "public.orders.user_id", to: "public.users.id" }, { from: "public.orders.x", to: "public.users.id" }] }), g);
  expect(r.joins).toEqual([{ from: "public.orders.user_id", to: "public.users.id" }]);
  expect(r.warnings.join(" ")).toContain("public.orders.x");
});

test("an answer with nothing usable is an error that says why", () => {
  const r = parseAiAnswer(wrap({ explanation: "hmm", request: { select: ["public.nope.x"] } }), g);
  expect(r.error).toMatch(/nothing usable/i);
});

test("a semicolon inside quotes is not a second statement", () => {
  expect(hasSecondStatement("SELECT 'a;b' FROM t")).toBe(false);
  expect(hasSecondStatement('SELECT "we;ird" FROM t')).toBe(false);
  expect(hasSecondStatement("SELECT 1; SELECT 2")).toBe(true);
});
