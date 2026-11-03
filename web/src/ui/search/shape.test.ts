import { aggLabel, dropAggregate, emptyShape, shapeToRequest } from "./shape";
import { draftToCond } from "./draft";
import { addLeaf, toRequest, toggleNot, cmpOptionsFor, parseValue } from "./searchTree";

test("an untouched shape adds nothing to the request", () => {
  expect(shapeToRequest(emptyShape())).toEqual({ fields: {}, errors: [] });
});

test("shape fields map to the request JSON", () => {
  const s = { ...emptyShape(), distinct: true, limit: "10", offset: "5", groupBy: ["public.orders.status"],
    aggregates: [{ func: "COUNT" as const, col: "", alias: "" }, { func: "SUM" as const, col: "public.orders.total", alias: "revenue" }],
    having: [{ agg: 0, cmp: ">=" as const, raw: "2" }],
    orderBy: [{ kind: "agg" as const, col: "", agg: 1, dir: "DESC" as const }, { kind: "col" as const, col: "public.orders.status", agg: 0, dir: "ASC" as const }] };
  expect(shapeToRequest(s)).toEqual({ errors: [], fields: {
    distinct: true, limit: 10, offset: 5, group_by: ["public.orders.status"],
    aggregates: [{ func: "COUNT" }, { func: "SUM", col: "public.orders.total", alias: "revenue" }],
    having: [{ agg: 0, cmp: ">=", value: 2 }],
    order_by: [{ agg: 1, dir: "DESC" }, { col: "public.orders.status", dir: "ASC" }] } });
});

test("bad numbers are reported, not sent", () => {
  const r = shapeToRequest({ ...emptyShape(), limit: "-3", offset: "x", aggregates: [{ func: "COUNT", col: "", alias: "" }], having: [{ agg: 0, cmp: ">", raw: "many" }] });
  expect(r.errors).toEqual(expect.arrayContaining(["Limit must be a whole number, 0 or more", "Offset must be a whole number, 0 or more", expect.stringContaining("Count of rows")]));
  expect(r.fields.limit).toBeUndefined();
});

test("removing an aggregate fixes the having and sort that point at later ones", () => {
  const s = { ...emptyShape(),
    aggregates: [{ func: "COUNT" as const, col: "", alias: "a" }, { func: "MAX" as const, col: "x.y.z", alias: "b" }, { func: "MIN" as const, col: "x.y.z", alias: "c" }],
    having: [{ agg: 0, cmp: ">" as const, raw: "1" }, { agg: 2, cmp: "<" as const, raw: "9" }],
    orderBy: [{ kind: "agg" as const, col: "", agg: 1, dir: "ASC" as const }, { kind: "agg" as const, col: "", agg: 2, dir: "DESC" as const }] };
  const r = dropAggregate(s, 1);
  expect(r.aggregates.map((a) => a.alias)).toEqual(["a", "c"]);
  expect(r.having.map((h) => h.agg)).toEqual([0, 1]);
  expect(r.orderBy).toEqual([{ kind: "agg", col: "", agg: 1, dir: "DESC" }]);
  expect(aggLabel(r.aggregates[1])).toBe("c");
});

test("a negated group becomes a NOT in the request, and empty ones vanish", () => {
  let t: any = addLeaf(null, [], { col: "public.a.x", cmp: "=", raw: "1" });
  t = toggleNot(t, []);
  const { cond } = draftToCond(t, () => "int4");
  expect(cond).toEqual({ not: { op: "AND", children: [{ col: "public.a.x", cmp: "=", value: 1 }] } });
  expect(toRequest(["public.a.x"], cond, {}, { limit: 3 })).toMatchObject({ limit: 3, where: { not: { op: "AND" } } });
});

test("new comparators are offered by type and parse like their siblings", () => {
  expect(cmpOptionsFor("text")).toEqual(expect.arrayContaining(["NOT LIKE", "NOT ILIKE", "~", "~*", "NOT BETWEEN"]));
  expect(cmpOptionsFor("int4")).toContain("NOT BETWEEN");
  expect(cmpOptionsFor("int4")).not.toContain("~");
  expect(parseValue("int4", "NOT BETWEEN", "1,5")).toEqual({ ok: true, value: [1, 5] });
});
