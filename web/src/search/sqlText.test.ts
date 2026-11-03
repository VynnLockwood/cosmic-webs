import { inlineParams, literal, sqlFor } from "./sqlText";

test("literals: text is quoted and escaped, numbers and booleans are bare, null is NULL", () => {
  expect(literal("it's")).toBe("'it''s'");
  expect(literal("BigLot 2565 (รอบเพิ่มเติม)")).toBe("'BigLot 2565 (รอบเพิ่มเติม)'");
  expect([literal(5), literal(1.5), literal(true), literal(null), literal(undefined), literal(NaN)]).toEqual(["5", "1.5", "TRUE", "NULL", "NULL", "NULL"]);
  expect(literal({ a: 1 })).toBe(`'{"a":1}'`);
});

test("$n placeholders become values, in any order, including $10 and repeats", () => {
  expect(inlineParams('SELECT 1 WHERE "t0"."a" = $2 AND "t0"."b" = $1 AND "t0"."c" = $2', ["x", 7])).toBe(`SELECT 1 WHERE "t0"."a" = 7 AND "t0"."b" = 'x' AND "t0"."c" = 7`);
  const many = Array.from({ length: 10 }, (_, i) => i * 10);
  expect(inlineParams("$1 $10 $2", many)).toBe("0 90 10");
});

test("a quoted identifier that looks like a placeholder is left alone, and so is a missing parameter", () => {
  expect(inlineParams('SELECT "$1" FROM "a""$2" WHERE x = $1', ["v"])).toBe(`SELECT "$1" FROM "a""$2" WHERE x = 'v'`);
  expect(inlineParams("x = $3", ["only one"])).toBe("x = $3");
});

test("sqlFor follows the mode and never changes the original", () => {
  const q = { sql: "a = $1", params: ["z"] };
  expect(sqlFor(q, "params")).toBe("a = $1");
  expect(sqlFor(q, "hardcoded")).toBe("a = 'z'");
  expect(q.sql).toBe("a = $1");
});
