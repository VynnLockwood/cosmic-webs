import { fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../store/useStore";
import type { Candidate, Flag, SchemaGraph } from "../types";
import { FlagList } from "./FlagList";
import { ResultsPanel } from "./ResultsPanel";

const t = (name: string) => ({ name, columns: [], row_estimate: 0 });
const fk = (id: string, a: string, b: string) => ({ id, from: { table: a, columns: ["x"] }, to: { table: b, columns: ["id"] } });
const graph: SchemaGraph = { tables: ["public.a", "public.b"].map(t), fks: [fk("f1", "public.a", "public.b"), fk("f2", "public.a", "public.b")] };
const cand: Candidate = { id: "c1", shape: "Join", fk_ids: ["f1"], tables: ["public.a", "public.b"], queries: [{ sql: 'SELECT 1 FROM "public"."a"', params: [] }], joins: 1, query_count: 1 };

test("results panel shows ranked cards with chips and sql", () => {
  useStore.setState({ graph, searchRequest: { select: ["public.a.x"], where: null, fk_choices: {} }, candidates: [cand], costs: { c1: { total_cost: 12.5, plan_rows: 3 } }, results: [{ id: "c1", score: 0, breakdown: { cost: 0, joins: 0, queries: 0, rows: 0 }, reason: "1 query, 1 join" }], flags: [] });
  render(<ResultsPanel />);
  expect(screen.getByLabelText("Plan 1")).toBeInTheDocument();
  expect(screen.getByText("1 join")).toBeInTheDocument();
  expect(screen.getByText("cost 12.5")).toBeInTheDocument();
  expect(screen.getByText(/SELECT 1 FROM/)).toBeInTheDocument();
});

test("hovering a card sets the highlighted plan", () => {
  useStore.setState({ hoverPlan: null });
  render(<ResultsPanel />);
  fireEvent.mouseEnter(screen.getByLabelText("Plan 1"));
  expect(useStore.getState().hoverPlan).toBe("c1");
  fireEvent.mouseLeave(screen.getByLabelText("Plan 1"));
  expect(useStore.getState().hoverPlan).toBeNull();
});

test("ambiguous fk flag shows chooser with one radio per fk", () => {
  const flag: Flag = { code: "AMBIGUOUS_FK", table: "public.a", column: null, message: "choose one" };
  useStore.setState({ graph, fkChoices: {} });
  render(<FlagList flags={[flag]} />);
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.getByText("AMBIGUOUS_FK")).toBeInTheDocument();
});

test("empty results with flags explains itself", () => {
  useStore.setState({ results: [], candidates: [], flags: [{ code: "UNREACHABLE", table: "public.b", column: null, message: "no path" }] });
  render(<ResultsPanel />);
  expect(screen.getByText(/No runnable plan/)).toBeInTheDocument();
  expect(screen.getByText("UNREACHABLE")).toBeInTheDocument();
});
