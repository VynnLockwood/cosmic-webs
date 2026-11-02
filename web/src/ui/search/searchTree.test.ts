import type { Cond } from "../../types";
import { addGroup, addLeaf, cmpOptionsFor, parseValue, removeNode, toggleOp, toRequest } from "./searchTree";

const leaf = (col: string, cmp: any, value?: unknown): Cond => ({ col, cmp, ...(value === undefined ? {} : { value }) });

test("addLeaf_nested_path", () => {
  let t = addLeaf(null, [], leaf("a.x", "=", 1));
  t = addGroup(t, [], "OR", leaf("a.y", "=", 2));
  t = addLeaf(t, [1], leaf("a.z", "=", 3));
  expect(t).toEqual({ op: "AND", children: [leaf("a.x", "=", 1), { op: "OR", children: [leaf("a.y", "=", 2), leaf("a.z", "=", 3)] }] });
});

test("removeNode_prunes_empty_group", () => {
  let t = addLeaf(null, [], leaf("a.x", "=", 1));
  t = addGroup(t, [], "OR", leaf("a.y", "=", 2));
  expect(removeNode(t, [1, 0])).toEqual({ op: "AND", children: [leaf("a.x", "=", 1)] });
  expect(removeNode({ op: "AND", children: [leaf("a.x", "=", 1)] }, [0])).toBeNull();
});

test("toggleOp flips a group", () => {
  expect(toggleOp({ op: "AND", children: [] }, [])).toEqual({ op: "OR", children: [] });
});

test("toRequest_matches_spec_example", () => {
  const where: Cond = {
    op: "AND",
    children: [leaf("public.orders.status", "=", 0), { op: "OR", children: [leaf("public.users.name", "=", "xxx"), leaf("public.users.name", "ILIKE", "%x%")] }],
  };
  expect(toRequest(["public.users.email", "public.orders.total"], where, {})).toEqual({
    select: ["public.users.email", "public.orders.total"],
    where,
    fk_choices: {},
  });
});

test("empty_tree_where_null", () => {
  expect(toRequest(["a.b.c"], null, {}).where).toBeNull();
  expect(toRequest(["a.b.c"], { op: "AND", children: [{ op: "OR", children: [] }] }, {}).where).toBeNull();
});

test("cmpOptions_bool_excludes_like", () => {
  expect(cmpOptionsFor("bool")).toEqual(["=", "!=", "IS NULL", "IS NOT NULL"]);
  expect(cmpOptionsFor("int4")).not.toContain("LIKE");
  expect(cmpOptionsFor("text")).toEqual(expect.arrayContaining(["LIKE", "ILIKE"]));
});

test("parseValue_int_rejects_text", () => {
  expect(parseValue("int4", "=", "abc")).toMatchObject({ ok: false });
  expect(parseValue("int4", "=", "42")).toEqual({ ok: true, value: 42 });
});

test("parseValue_between", () => {
  expect(parseValue("int4", "BETWEEN", "1,5")).toEqual({ ok: true, value: [1, 5] });
  expect(parseValue("int4", "BETWEEN", "1")).toMatchObject({ ok: false });
});

test("parseValue_in_and_null", () => {
  expect(parseValue("text", "IN", "a, b")).toEqual({ ok: true, value: ["a", "b"] });
  expect(parseValue("text", "IS NULL", "")).toEqual({ ok: true });
});

test("percent_and_quote_values_preserved", () => {
  const raw = "50%'; --";
  expect(parseValue("text", "=", raw)).toEqual({ ok: true, value: raw });
  expect(parseValue("text", "LIKE", raw)).toEqual({ ok: true, value: raw });
});
