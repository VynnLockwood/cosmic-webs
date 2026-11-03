import { describeRequest, droppedFrom, type Seg } from "./describeRequest";
import type { Flag, SearchRequest } from "../types";

const flag = (code: Flag["code"], table: string | null, column: string | null = null): Flag => ({ code, table, column, message: "" });
const text = (segs: Seg[]) => segs.map((s) => s.text).join("");
const gone = (segs: Seg[]) => segs.filter((s) => s.dropped).map((s) => s.text);

const req: SearchRequest = {
  select: ["public.users.email", "public.sppProject.name"],
  where: { op: "AND", children: [
    { col: "public.users.id", cmp: ">", value: 5 },
    { col: "public.sppProject.id", cmp: "=", value: "abc" },
    { op: "OR", children: [{ col: "public.sppProject.x", cmp: "IS NULL" }, { col: "public.orders.status", cmp: "IN", value: [0, 1] }] },
  ] },
  fk_choices: {},
  order_by: [{ col: "public.sppProject.name", dir: "DESC" }, { col: "public.users.email" }],
  limit: 10,
};

test("dropped tables and unknown columns come from the flags", () => {
  const d = droppedFrom([flag("UNREACHABLE", "public.sppProject"), flag("UNKNOWN_COLUMN", "public.users", "public.users.nope"), flag("AMBIGUOUS_FK", "public.orders")]);
  expect([...d.tables]).toEqual(["public.sppProject"]);
  expect([...d.columns]).toEqual(["public.users.nope"]);
});

test("the original request is shown as SQL-like text with every dropped part marked", () => {
  const d = droppedFrom([flag("UNREACHABLE", "public.sppProject")]);
  const lines = describeRequest(req, d);
  expect(lines.map((l) => text(l))).toEqual([
    "SELECT users.email, sppProject.name",
    "WHERE users.id > 5 AND sppProject.id = 'abc' AND (sppProject.x IS NULL OR orders.status IN (0, 1))",
    "ORDER BY sppProject.name DESC, users.email ASC",
    "LIMIT 10",
  ]);
  expect(gone(lines[0])).toEqual(["sppProject.name"]);
  expect(gone(lines[1])).toEqual(["sppProject.id = 'abc'", "sppProject.x IS NULL"]);
  expect(gone(lines[2])).toEqual(["sppProject.name DESC"]);
});

test("a group whose parts are all dropped is dropped as a whole, a NOT keeps its shape", () => {
  const d = droppedFrom([flag("UNREACHABLE", "public.a")]);
  const lines = describeRequest({ select: ["public.a.x"], fk_choices: {}, where: { not: { op: "AND", children: [{ col: "public.a.x", cmp: "=", value: 1 }, { col: "public.a.y", cmp: "!=", value: null }] } } }, d);
  expect(text(lines[1])).toBe("WHERE NOT (a.x = 1 AND a.y != NULL)");
  expect(gone(lines[1])).toEqual(["NOT (a.x = 1 AND a.y != NULL)"]);
});

test("aggregates, grouping and distinct are described too; nothing dropped means no marks", () => {
  const lines = describeRequest({ select: ["public.u.name"], where: null, fk_choices: {}, distinct: true, aggregates: [{ func: "COUNT_DISTINCT", col: "public.o.id", alias: "n" }, { func: "COUNT" }], group_by: ["public.u.name"], having: [{ agg: 1, cmp: ">=", value: 2 }] }, droppedFrom([]));
  expect(lines.map((l) => text(l))).toEqual([
    "SELECT DISTINCT u.name, COUNT(DISTINCT o.id) AS n, COUNT(*)",
    "GROUP BY u.name",
    "HAVING COUNT(*) >= 2",
  ]);
  expect(lines.flat().some((s) => s.dropped)).toBe(false);
});
