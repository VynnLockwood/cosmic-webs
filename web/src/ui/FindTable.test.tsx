import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { motionActions } from "../scene/camera/motion";
import { useStore } from "../store/useStore";
import { FindTable } from "./FindTable";
import type { SchemaGraph } from "../types";

const col = (name: string) => ({ name, type: "int4", nullable: false, pk: false });
const graph: SchemaGraph = {
  tables: [
    { name: "public.users", row_estimate: 10, columns: [col("id"), col("email")] },
    { name: "public.orders", row_estimate: 20, columns: [col("id"), col("total")] },
    { name: "public.order_items", row_estimate: 30, columns: [col("id"), col("qty")] },
    { name: "sales.invoices", row_estimate: 5, columns: [col("id")] },
  ],
  fks: [],
};
const box = () => screen.getByRole("combobox", { name: "Find table" });
const opts = () => within(screen.getByRole("listbox", { name: "Find table options" })).getAllByRole("option").map((o) => o.textContent);

beforeEach(() => {
  useStore.setState({ graph, dotOverrides: {}, linkOverrides: {}, hoveredTable: null });
  motionActions.flyToTable = vi.fn();
});

test("typing part of a table name lists the tables that match", () => {
  render(<FindTable />);
  fireEvent.focus(box());
  expect(opts()).toHaveLength(4);
  fireEvent.change(box(), { target: { value: "ord" } });
  expect(opts()).toEqual([expect.stringContaining("orders"), expect.stringContaining("order_items")]);
});

test("a column name finds its table too", () => {
  render(<FindTable />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: "email" } });
  expect(opts()).toEqual([expect.stringContaining("users")]);
});

test("matching dots light up and the rest dim while you type, then everything is restored", () => {
  useStore.setState({ dotOverrides: { "public.users": "flagged" } });
  render(<FindTable />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: "ord" } });
  const o = useStore.getState().dotOverrides;
  expect(o["public.orders"]).toBe("selected"); // the highlighted row
  expect(o["public.order_items"]).toBe("required");
  expect(o["public.users"]).toBe("dimmed");
  expect(o["sales.invoices"]).toBe("dimmed");
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(useStore.getState().dotOverrides).toEqual({ "public.users": "flagged" });
});

test("arrow keys change which dot is the active one, Enter flies there", () => {
  render(<FindTable />);
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: "ord" } });
  fireEvent.keyDown(box(), { key: "ArrowDown" });
  expect(useStore.getState().dotOverrides["public.order_items"]).toBe("selected");
  expect(useStore.getState().dotOverrides["public.orders"]).toBe("required");
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(motionActions.flyToTable).toHaveBeenCalledWith("public.order_items");
  expect((box() as HTMLInputElement).value).toBe("");
});

test("the find event (Ctrl/Cmd+K) focuses the box", () => {
  render(<FindTable />);
  act(() => void window.dispatchEvent(new Event("cosmos:find")));
  expect(document.activeElement).toBe(box());
});

test("a graph with no tables still renders an empty, harmless box", () => {
  useStore.setState({ graph: { tables: [], fks: [] } });
  render(<FindTable />);
  fireEvent.focus(box());
  expect(screen.getByText("No matches")).toBeInTheDocument();
});
