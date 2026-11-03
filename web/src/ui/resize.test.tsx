import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { useStore } from "../store/useStore";
import { clampWidth, ResizeHandle } from "./ResizeHandle";
import { Drawer } from "./Drawer";
import { TablePanel } from "./TablePanel";

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ drawer: "schema", panelTable: null, panelWidths: { drawer: null, panel: null } });
});

test("clampWidth keeps a panel usable and on screen", () => {
  expect(clampWidth(100, 1000)).toBe(280);
  expect(clampWidth(5000, 1000)).toBe(800); // never more than 80% of the window
  expect(clampWidth(500, 1000)).toBe(500);
  expect(clampWidth(500, 300)).toBe(280); // tiny window: the minimum wins
});

test("dragging the drawer's edge changes its width and the choice is remembered", () => {
  render(<Drawer />);
  const handle = screen.getByRole("separator", { name: "Resize function drawer" });
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
  fireEvent.pointerDown(handle, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 560, pointerId: 1 });
  expect(useStore.getState().panelWidths.drawer).toBe(320 + 160);
  expect(screen.getByLabelText("Function drawer").style.width).toBe("480px");
  expect(JSON.parse(localStorage.getItem("cosmos.widths")!)).toMatchObject({ drawer: 480 });
});

test("the right-hand table panel grows when its left edge is dragged left", () => {
  useStore.setState({ graph: { tables: [{ name: "public.a", row_estimate: 1, columns: [] }], fks: [] }, panelTable: "public.a" });
  render(<TablePanel api={{ getRows: async () => ({ columns: [], rows: [], total_estimate: 0 }) }} />);
  const handle = screen.getByRole("separator", { name: "Resize table panel" });
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 900, pointerId: 1 });
  expect(useStore.getState().panelWidths.panel).toBe(420 + 100);
});

test("keyboard and double-click work on the handle", () => {
  render(<Drawer />);
  const handle = screen.getByRole("separator", { name: "Resize function drawer" });
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(useStore.getState().panelWidths.drawer).toBe(320 + 24);
  fireEvent.doubleClick(handle);
  expect(useStore.getState().panelWidths.drawer).toBeNull();
});

test("a broken saved value in localStorage is ignored", async () => {
  localStorage.setItem("cosmos.widths", "{nope");
  const { loadWidths } = await import("../store/useStore");
  expect(loadWidths()).toEqual({ drawer: null, panel: null });
});
