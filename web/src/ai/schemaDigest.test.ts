import type { SchemaGraph } from "../types";
import { schemaDigest, tableLine } from "./schemaDigest";

const t = (name: string, cols: [string, string, boolean?][]) => ({ name, row_estimate: 12345, columns: cols.map(([n, ty, pk]) => ({ name: n, type: ty, nullable: false, pk: !!pk })) });
const g: SchemaGraph = {
  tables: [t("public.users", [["id", "int4", true], ["email", "text"]]), t("public.orders", [["id", "int4", true], ["user_id", "int4"], ["total", "numeric"]]), t("public.zebra", [["id", "int4", true], ["stripes", "int4"]])],
  fks: [{ id: "f", from: { table: "public.orders", columns: ["user_id"] }, to: { table: "public.users", columns: ["id"] } }],
};

test("a table line has names, types, keys and links, and nothing about rows", () => {
  expect(tableLine(g, "public.orders")).toBe("public.orders(id int4 PK, user_id int4 FK→public.users.id, total numeric)");
  expect(schemaDigest(g, "anything").text).not.toMatch(/12345/);
});

test("a small schema is sent whole", () => {
  const d = schemaDigest(g, "orders by user");
  expect(d.tables).toBe(3);
  expect(d.text.split("\n")).toHaveLength(3);
});

test("a schema over the budget keeps the tables the goal names plus their links", () => {
  const d = schemaDigest(g, "total per user email", 140);
  expect(d.total).toBe(3);
  expect(d.text).toContain("public.orders");
  expect(d.text).toContain("public.users");
  expect(d.text).not.toContain("zebra");
  expect(d.text.length).toBeLessThanOrEqual(140);
});

test("nothing matches: still sends something small rather than nothing", () => {
  const d = schemaDigest(g, "qqq", 140);
  expect(d.tables).toBeGreaterThan(0);
});
