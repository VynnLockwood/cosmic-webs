import { fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../store/useStore";
import { ranked } from "../testing/fixtures";
import type { Candidate, Flag, SchemaGraph } from "../types";
import { FlagList } from "./FlagList";
import { ResultsPanel } from "./ResultsPanel";

const t = (name: string) => ({ name, columns: [], row_estimate: 0 });
const fk = (id: string, a: string, b: string) => ({ id, from: { table: a, columns: ["x"] }, to: { table: b, columns: ["id"] } });
const graph: SchemaGraph = { tables: ["public.a", "public.b"].map(t), fks: [fk("f1", "public.a", "public.b"), fk("f2", "public.a", "public.b")] };
const cand: Candidate = { id: "c1", shape: "Join", fk_ids: ["f1"], tables: ["public.a", "public.b"], queries: [{ sql: 'SELECT 1 FROM "public"."a"', params: [] }], joins: 1, query_count: 1 };

test("results panel shows ranked cards with chips and sql", () => {
  useStore.setState({ sqlMode: "params" });
  useStore.setState({ graph, searchRequest: { select: ["public.a.x"], where: null, fk_choices: {} }, candidates: [cand], costs: { c1: { total_cost: 12.5, plan_rows: 3 } }, results: [ranked("c1", { reason: "1 query, 1 join" })], flags: [] });
  render(<ResultsPanel />);
  expect(screen.getByLabelText("Plan 1")).toBeInTheDocument();
  expect(screen.getByText("1 join")).toBeInTheDocument();
  expect(screen.getByText("est. cost 12.5")).toBeInTheDocument();
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


import type { Metric } from "../types";
const mm = (value: number, best: number, worst: number, weight: number): Metric => {
  const norm = worst > best ? (value - best) / (worst - best) : 0;
  return { value, best, worst, norm, weight, points: weight * norm };
};
const sheet = (id: string, c: number, q: number) => {
  const detail = { cost: mm(c, 10, 50, 0.5), queries: mm(q, 1, 2, 0.25), joins: mm(1, 1, 1, 0.15), rows: mm(100, 100, 100, 0.1) };
  const score = detail.cost.points + detail.queries.points;
  return ranked(id, { score, compared: 3, detail, breakdown: { cost: detail.cost.points, queries: detail.queries.points, joins: 0, rows: 0 } });
};

test("each card explains its rank with a score sheet that adds up", () => {
  const c2: Candidate = { ...cand, id: "c2" };
  useStore.setState({ graph, searchRequest: { select: ["public.a.x"], where: null, fk_choices: {} }, candidates: [cand, c2], results: [sheet("c1", 10, 1), sheet("c2", 30, 2)], flags: [], splitHidden: 0 });
  render(<ResultsPanel />);
  const first = screen.getByLabelText("Score sheet for plan 1");
  expect(first).toHaveTextContent("Estimated cost (planner)");
  expect(first).toHaveTextContent("Score (lower is better)");
  expect(screen.getByText(/Best score \(0\.00/)).toBeInTheDocument();
  expect(screen.getByText(/Behind #1 by/)).toBeInTheDocument();
});

test("how ranking works lists the weights", () => {
  render(<ResultsPanel />);
  const weights = screen.getByLabelText("Ranking weights");
  expect(weights).toHaveTextContent("50 %");
  expect(weights).toHaveTextContent("Number of queries");
  expect(screen.getByText(/plans compared by the planner's estimated cost/)).toBeInTheDocument();
});

test("hidden split plans are announced", () => {
  useStore.setState({ splitHidden: 2 });
  render(<ResultsPanel />);
  expect(screen.getByText(/2 split plan\(s\) hidden/)).toBeInTheDocument();
});

test("SQL can be shown with $1 params or with the values written in, and Copy follows the choice", () => {
  const withParam: Candidate = { ...cand, queries: [{ sql: 'SELECT 1 FROM "public"."a" AS "t0" WHERE "t0"."x" = $1', params: ["BigLot 'x'"] }] };
  useStore.setState({ graph, searchRequest: { select: ["public.a.x"], where: null, fk_choices: {} }, candidates: [withParam], results: [ranked("c1", {})], flags: [], sqlMode: "hardcoded" });
  const copied: string[] = [];
  Object.assign(navigator, { clipboard: { writeText: (t: string) => copied.push(t) } });
  render(<ResultsPanel />);
  expect(screen.getByText(/WHERE "t0"."x" = 'BigLot ''x'''/)).toBeInTheDocument();
  expect(screen.queryByText(/params:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(copied.at(-1)).toContain("= 'BigLot ''x'''");
  fireEvent.click(screen.getByRole("button", { name: "Params ($1)" }));
  expect(useStore.getState().sqlMode).toBe("params");
  expect(screen.getByText(/WHERE "t0"."x" = \$1/)).toBeInTheDocument();
  expect(screen.getByText(/params:/)).toBeInTheDocument();
  expect(localStorage.getItem("cosmos.sqlMode")).toBe("params");
});
