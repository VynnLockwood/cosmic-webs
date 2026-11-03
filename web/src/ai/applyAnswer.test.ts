import { draftToCond } from "../ui/search/draft";
import { shapeToRequest } from "../ui/search/shape";
import { rawValue, requestToBuilder, sqlCandidates } from "./applyAnswer";
import type { SearchRequest } from "../types";

test("values are written the way the builder reads them", () => {
  expect([rawValue("a b"), rawValue(5), rawValue(true), rawValue([1, 2]), rawValue(["x", "y"]), rawValue(null)]).toEqual(["a b", "5", "true", "1,2", "x,y", ""]);
});

const type = (c: string) => ({ "public.orders.status": "int4", "public.orders.total": "numeric", "public.users.name": "text" } as Record<string, string>)[c];

test("a request round-trips through the builder: what the model said is what Search will send", () => {
  const req: SearchRequest = {
    select: ["public.users.name"], fk_choices: {},
    where: { op: "AND", children: [{ col: "public.orders.status", cmp: "IN", value: [0, 1] }, { not: { col: "public.users.name", cmp: "ILIKE", value: "%x%" } }, { op: "OR", children: [{ col: "public.orders.total", cmp: "BETWEEN", value: [1, 9.5] }, { col: "public.orders.total", cmp: "IS NULL" }] }] },
    distinct: true, aggregates: [{ func: "SUM", col: "public.orders.total", alias: "paid" }, { func: "COUNT" }], group_by: ["public.users.name"],
    having: [{ agg: 1, cmp: ">=", value: 2 }], order_by: [{ agg: 0, dir: "DESC" }, { col: "public.users.name", dir: "ASC" }], limit: 20, offset: 5,
  };
  const b = requestToBuilder(req);
  const { cond, errors } = draftToCond(b.draft, type);
  expect(errors).toEqual([]);
  // the editor negates groups, so NOT around one condition comes back as NOT around a one-condition group (same SQL)
  const expected = structuredClone(req.where) as any;
  expected.children[1] = { not: { op: "AND", children: [expected.children[1].not] } };
  expect(cond).toEqual(expected);
  const sh = shapeToRequest(b.shape);
  expect(sh.errors).toEqual([]);
  expect(sh.fields).toEqual({ distinct: true, limit: 20, offset: 5, aggregates: req.aggregates, group_by: req.group_by, having: req.having, order_by: req.order_by });
  expect(b.select).toEqual(["public.users.name"]);
});

test("a lone condition becomes a group so the editor can show it; no condition means no draft", () => {
  expect(requestToBuilder({ select: ["a.b.c"], fk_choices: {}, where: { col: "public.orders.status", cmp: "=", value: 1 } }).draft).toEqual({ op: "AND", children: [{ col: "public.orders.status", cmp: "=", raw: "1" }] });
  expect(requestToBuilder({ select: ["a.b.c"], fk_choices: {}, where: null }).draft).toBeNull();
});

test("a top-level NOT keeps its meaning", () => {
  const b = requestToBuilder({ select: ["x.y.z"], fk_choices: {}, where: { not: { col: "public.orders.status", cmp: "=", value: 3 } } });
  expect(draftToCond(b.draft, type).cond).toEqual({ not: { op: "AND", children: [{ col: "public.orders.status", cmp: "=", value: 3 }] } });
});

test("the model's SQL becomes ranked candidates with a join count", () => {
  const c = sqlCandidates([{ title: "t", sql: "SELECT 1 FROM a LEFT JOIN b ON a.id = b.id JOIN c ON c.id = b.id", params: [] }, { title: "u", sql: "SELECT 2", params: [7] }]);
  expect(c.map((x) => [x.id, x.joins, x.query_count])).toEqual([["ai1", 2, 1], ["ai2", 0, 1]]);
  expect(c[1].queries[0].params).toEqual([7]);
});
