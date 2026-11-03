import type { SchemaGraph } from "../types";
import { joinErrors, withJoins } from "./virtualJoins";

const col = (name: string) => ({ name, type: "int4", nullable: false, pk: false });
const graph: SchemaGraph = {
  tables: [
    { name: "public.users", row_estimate: 1, columns: [col("id"), col("code")] },
    { name: "public.orders", row_estimate: 1, columns: [col("id"), col("user_code")] },
  ],
  fks: [],
};

test("a custom join becomes a link the planner can use, and the original graph is untouched", () => {
  const g = withJoins(graph, [{ from: "public.orders.user_code", to: "public.users.code" }]);
  expect(g.fks).toEqual([{ id: "join:1", from: { table: "public.orders", columns: ["user_code"] }, to: { table: "public.users", columns: ["code"] } }]);
  expect(graph.fks).toHaveLength(0);
});

test("half-filled or invalid joins are reported and not used", () => {
  const joins = [
    { from: "", to: "public.users.code" },
    { from: "public.orders.nope", to: "public.users.code" },
    { from: "public.orders.id", to: "public.orders.user_code" },
    { from: "public.orders.user_code", to: "public.users.code" },
  ];
  expect(joinErrors(graph, joins)).toEqual([
    "Join 1: pick both columns",
    "Join 2: public.orders.nope does not exist",
    "Join 3: the two columns are in the same table",
  ]);
  expect(withJoins(graph, joins).fks.map((f) => f.id)).toEqual(["join:4"]);
});

test("the same join twice adds one link", () => {
  const j = { from: "public.orders.user_code", to: "public.users.code" };
  expect(withJoins(graph, [j, { from: j.to, to: j.from }]).fks).toHaveLength(1);
});
