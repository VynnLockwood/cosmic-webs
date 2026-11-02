import { ambiguousPairs, planOverrides, requiredTables } from "./highlight";
import type { Candidate, Flag, SchemaGraph, SearchRequest } from "../types";

const t = (name: string) => ({ name, columns: [], row_estimate: 0 });
const fk = (id: string, a: string, b: string) => ({ id, from: { table: a, columns: ["x"] }, to: { table: b, columns: ["id"] } });
const graph: SchemaGraph = {
  tables: ["public.a", "public.b", "public.c", "public.iso"].map(t),
  fks: [fk("f1", "public.a", "public.b"), fk("f2", "public.b", "public.c"), fk("f3", "public.a", "public.b")],
};
const cand: Candidate = { id: "c1", shape: "Join", fk_ids: ["f1", "f2"], tables: ["public.a", "public.b", "public.c"], queries: [], joins: 2, query_count: 1 };

test("requiredTables collects select and where tables", () => {
  const req: SearchRequest = { select: ["public.a.x"], where: { op: "AND", children: [{ col: "public.c.y", cmp: "=", value: 1 }] }, fk_choices: {} };
  expect(requiredTables(req).sort()).toEqual(["public.a", "public.c"]);
});

test("planOverrides marks path, required, dimmed and flagged", () => {
  const flags: Flag[] = [
    { code: "UNREACHABLE", table: "public.iso", column: null, message: "m" },
    { code: "AMBIGUOUS_FK", table: "public.a", column: null, message: "m" },
  ];
  const o = planOverrides(graph, cand, ["public.a", "public.c"], flags, {});
  expect(o.dots["public.a"]).toBe("required");
  expect(o.dots["public.b"]).toBe("path");
  expect(o.dots["public.iso"]).toBe("flagged");
  expect(o.links.f1).toBe("path");
  expect(o.links.f3).toBe("ambiguous");
});

test("with no candidate non-required dots are dimmed", () => {
  const o = planOverrides(graph, null, ["public.a"], [], {});
  expect(o.dots["public.a"]).toBe("required");
  expect(o.dots["public.c"]).toBe("dimmed");
});

test("ambiguousPairs finds parallel fks and honours choices", () => {
  const flag: Flag = { code: "AMBIGUOUS_FK", table: "public.a", column: null, message: "" };
  const p = ambiguousPairs(graph, flag, {});
  expect(p).toHaveLength(1);
  expect(p[0].key).toBe("public.a|public.b");
  expect(p[0].fks.map((f) => f.id)).toEqual(["f1", "f3"]);
  expect(ambiguousPairs(graph, flag, { "public.a|public.b": "f3" })[0].chosen).toBe("f3");
});
