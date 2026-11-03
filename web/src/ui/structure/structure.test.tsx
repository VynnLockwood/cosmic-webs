import { fireEvent, render, screen, within } from "@testing-library/react";
import shop from "../../../../samples/shop.graph.json";
import { useStore } from "../../store/useStore";
import type { Experiment, SchemaGraph } from "../../types";

const mocks = vi.hoisted(() => ({ applyStructure: vi.fn(async () => true), refillData: vi.fn(async () => true), loadStructure: vi.fn(async () => {}) }));
vi.mock("../../store/structureActions", async (orig) => ({ ...(await orig<typeof import("../../store/structureActions")>()), ...mocks }));

import { StructurePanel } from "./StructurePanel";

const graph = shop as SchemaGraph;
const idx = (name: string, table: string, columns: string[], primary = false) => ({ schema: "public", table, name, columns, unique: primary, primary, definition: "" });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockClear());
  useStore.setState({ graph, sourceMode: "sandbox", experiments: [], structureError: null, structureBusy: false, lastExecuted: [], searchRequest: null,
    indexes: [idx("orders_pkey", "public.orders", ["id"], true), idx("ix_orders_user", "public.orders", ["user_id"])] });
});

test("adds an index on the chosen table and columns", () => {
  render(<StructurePanel />);
  fireEvent.change(screen.getByLabelText("Table"), { target: { value: "public.orders" } });
  fireEvent.click(screen.getByLabelText("index column user_id"));
  fireEvent.click(screen.getByLabelText("index column status"));
  fireEvent.click(screen.getByRole("button", { name: "Add index" }));
  expect(mocks.applyStructure).toHaveBeenCalledWith([{ kind: "create_index", table: "public.orders", columns: ["user_id", "status"], unique: false }]);
});

test("Add index stays disabled until a column is picked", () => {
  render(<StructurePanel />);
  expect(screen.getByRole("button", { name: "Add index" })).toBeDisabled();
});

test("the primary-key index cannot be dropped, other indexes can", () => {
  render(<StructurePanel />);
  expect(screen.queryByLabelText("Drop index orders_pkey")).toBeNull();
  fireEvent.click(screen.getByLabelText("Drop index ix_orders_user"));
  expect(mocks.applyStructure).toHaveBeenCalledWith([{ kind: "drop_index", schema: "public", name: "ix_orders_user" }]);
});

test("adds and drops a foreign key (a link)", () => {
  render(<StructurePanel />);
  fireEvent.change(screen.getByLabelText("FK from table"), { target: { value: "public.reviews" } });
  fireEvent.change(screen.getByLabelText("FK from column"), { target: { value: "rating" } });
  fireEvent.change(screen.getByLabelText("FK to table"), { target: { value: "public.orders" } });
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  expect(mocks.applyStructure).toHaveBeenCalledWith([{ kind: "add_fk", table: "public.reviews", columns: ["rating"], ref_table: "public.orders", ref_columns: ["id"] }]);
  fireEvent.click(screen.getByLabelText(`Drop foreign key ${graph.fks[0].id}`));
  expect(mocks.applyStructure).toHaveBeenLastCalledWith([{ kind: "drop_fk", table: graph.fks[0].from.table, name: graph.fks[0].id }]);
});

test("adds a column with a type and drops one", () => {
  render(<StructurePanel />);
  fireEvent.change(screen.getByLabelText("Column table"), { target: { value: "public.orders" } });
  fireEvent.change(screen.getByLabelText("New column name"), { target: { value: " note " } });
  fireEvent.change(screen.getByLabelText("New column type"), { target: { value: "jsonb" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(mocks.applyStructure).toHaveBeenCalledWith([{ kind: "add_column", table: "public.orders", name: "note", type: "jsonb" }]);
  fireEvent.change(screen.getByLabelText("Column to drop"), { target: { value: "total" } });
  fireEvent.click(screen.getByRole("button", { name: "Drop column" }));
  expect(mocks.applyStructure).toHaveBeenLastCalledWith([{ kind: "drop_column", table: "public.orders", name: "total" }]);
});

test("data size buttons refill the sandbox", () => {
  render(<StructurePanel />);
  fireEvent.click(screen.getByRole("button", { name: "50,000 rows" }));
  expect(mocks.refillData).toHaveBeenCalledWith(50000);
});

test("advanced DDL is sent as a raw statement", () => {
  render(<StructurePanel />);
  fireEvent.change(screen.getByLabelText("DDL statement"), { target: { value: "create index on orders (total)" } });
  fireEvent.click(within(screen.getByText("Advanced: run one DDL statement").closest("details")!).getByRole("button", { name: "Run" }));
  expect(mocks.applyStructure).toHaveBeenCalledWith([{ kind: "sql", statement: "create index on orders (total)" }]);
});

const exp = (id: number, label: string, value: number, metric: "cost" | "time" = "cost"): Experiment => ({ id, label, plans: 3, flags: 0, best: { id: "c1", shape: "Join", joins: 1, queries: 1, value, metric, score: 0, sql: "select 1" } });

test("the comparison table shows each change against the baseline", () => {
  useStore.setState({ experiments: [exp(0, "Baseline (before any change)", 100), exp(1, "+ index orders(user_id)", 25), exp(2, "− index ix", 130)] });
  render(<StructurePanel />);
  const t = screen.getByLabelText("Experiment results");
  expect(t).toHaveTextContent("baseline");
  expect(within(t).getByText("-75%")).toHaveClass("good");
  expect(within(t).getByText("+30%")).toHaveClass("bad");
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(useStore.getState().experiments).toEqual([]);
});

test("measured run times are shown in ms and not compared with estimated costs", () => {
  useStore.setState({ experiments: [exp(0, "Baseline", 12.5, "time"), exp(1, "x", 3, "cost")] });
  render(<StructurePanel />);
  const t = screen.getByLabelText("Experiment results");
  expect(t).toHaveTextContent("12.50 ms");
  expect(within(t).getAllByText("—").length).toBeGreaterThan(0);
});

test("explains what to do before a search exists", () => {
  render(<StructurePanel />);
  expect(screen.getByText(/Run a search first/)).toBeInTheDocument();
});

test("errors and the executed SQL are shown", () => {
  useStore.setState({ structureError: "unknown column orders.nope", lastExecuted: ["CREATE INDEX ix ON orders (a)"] });
  render(<StructurePanel />);
  expect(screen.getByRole("alert")).toHaveTextContent("unknown column orders.nope");
  expect(screen.getByLabelText("Executed SQL")).toHaveTextContent("CREATE INDEX ix");
});

test("on a live database the lab is switched off", () => {
  useStore.setState({ sourceMode: "live" });
  render(<StructurePanel />);
  expect(screen.getByText(/never on a live database/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add index" })).toBeNull();
  expect(mocks.loadStructure).not.toHaveBeenCalled();
});
