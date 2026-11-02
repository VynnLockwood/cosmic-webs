import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import shop from "../../../samples/shop.graph.json";
import { loadSchema } from "../store/actions";
import { useStore } from "../store/useStore";
import type { SchemaGraph } from "../types";
import { Drawer } from "./Drawer";
import { Rail } from "./Rail";
import { TablePanel } from "./TablePanel";

const graph = shop as SchemaGraph;
beforeEach(() => useStore.setState({ graph: null, drawer: null, panelTable: null, schemaError: null, warnings: [] }));

test("rail_icon_opens_drawer", () => {
  render(<><Rail /><Drawer /></>);
  expect(screen.getByLabelText("Function drawer")).not.toHaveClass("open");
  fireEvent.click(screen.getByRole("button", { name: "Schema" }));
  expect(screen.getByLabelText("Function drawer")).toHaveClass("open");
  expect(screen.getByRole("heading", { name: "Schema" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Schema" }));
  expect(screen.getByLabelText("Function drawer")).not.toHaveClass("open");
});

test("ddl_error_shows_line_and_keeps_graph", async () => {
  useStore.getState().setGraph(graph);
  useStore.getState().setDrawer("schema");
  render(<Drawer />);
  const api = { postSchema: async () => { throw new ApiError(422, { message: "syntax error at or near \"tabel\"", line: 3, col: 5 }); } } as any;
  await act(() => loadSchema("create tabel x();", { api }));
  expect(screen.getByRole("alert")).toHaveTextContent("Line 3, col 5");
  expect(useStore.getState().graph?.tables.length).toBe(25);
});

test("table_panel_shows_pk_fk_badges", async () => {
  useStore.setState({ graph, panelTable: "public.orders" });
  const api = { getRows: async () => ({ columns: ["id"], rows: [[1]] as unknown[][], total_estimate: 1000 }) };
  render(<TablePanel api={api} />);
  const items = await screen.findAllByRole("listitem");
  const id = items.find((li) => li.textContent?.startsWith("id "))!;
  expect(id).toHaveTextContent("PK");
  const user = items.find((li) => li.textContent?.startsWith("user_id"))!;
  expect(user).toHaveTextContent("FK → users");
});

test("rows_paged_50", async () => {
  useStore.setState({ graph, panelTable: "public.users" });
  const calls: number[][] = [];
  const api = { getRows: async (_t: string, limit = 50, offset = 0) => (calls.push([limit, offset]), { columns: ["id"], rows: Array.from({ length: 50 }, (_, i) => [offset + i]) as unknown[][], total_estimate: 1000 }) };
  render(<TablePanel api={api} />);
  await waitFor(() => expect(calls).toEqual([[50, 0]]));
  fireEvent.click(await screen.findByText("Next"));
  await waitFor(() => expect(calls[1]).toEqual([50, 50]));
});
