import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useStore } from "../../store/useStore";
import { SearchPanel } from "./SearchPanel";
import { emptyShape } from "./shape";
import type { SchemaGraph } from "../../types";

const graph: SchemaGraph = {
  tables: [
    { name: "public.users", row_estimate: 10, columns: [{ name: "id", type: "int4", nullable: false, pk: true }, { name: "email", type: "text", nullable: false, pk: false }] },
    { name: "public.orders", row_estimate: 10, columns: [{ name: "id", type: "int4", nullable: false, pk: true }, { name: "status", type: "int4", nullable: false, pk: false }, { name: "total", type: "numeric", nullable: false, pk: false }] },
  ],
  fks: [],
};
const opts = (name: string) => within(screen.getByRole("listbox", { name: `${name} options` })).getAllByRole("option");
const getValues = vi.fn(async (_t: string, _c: string, q?: string) => ({
  values: [{ value: 0, count: 700 }, { value: 1, count: 200 }, { value: 2, count: 100 }].filter((v) => !q || String(v.value).includes(q)),
  truncated: false,
}));

beforeEach(() => {
  getValues.mockClear();
  useStore.setState({ graph, searchSelect: ["public.users.email"], searchDraft: null, searchShape: emptyShape(), importProgress: null, searchRequest: null });
});

async function addCondition() {
  fireEvent.click(screen.getByRole("button", { name: "+ Condition" }));
  await act(async () => {});
}

test("the condition column is a search box: type a few letters, pick from the matches", async () => {
  render(<SearchPanel getValues={getValues} />);
  await addCondition();
  const box = screen.getByRole("combobox", { name: "Condition column" });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: "ord stat" } });
  const options = opts("Condition column");
  expect(options).toHaveLength(1);
  fireEvent.mouseDown(options[0]);
  expect((screen.getByRole("combobox", { name: "Condition column" }) as HTMLInputElement).value).toBe("public.orders.status");
});

test("the value box offers every value the column holds, with counts, and narrows as you type", async () => {
  render(<SearchPanel getValues={getValues} />);
  await addCondition();
  fireEvent.mouseDown((fireEvent.focus(screen.getByRole("combobox", { name: "Condition column" })), fireEvent.change(screen.getByRole("combobox", { name: "Condition column" }), { target: { value: "orders.status" } }), opts("Condition column")[0]));
  const value = screen.getByRole("combobox", { name: "Condition value" });
  fireEvent.focus(value);
  await waitFor(() => expect(getValues).toHaveBeenCalledWith("public.orders", "status", ""));
  await waitFor(() => expect(opts("Condition value").map((o) => o.textContent)).toEqual(["0700×", "1200×", "2100×"]));
  fireEvent.change(value, { target: { value: "2" } });
  await waitFor(() => expect(getValues).toHaveBeenCalledWith("public.orders", "status", "2"));
  await waitFor(() => expect(opts("Condition value")).toHaveLength(1));
  fireEvent.mouseDown(opts("Condition value")[0]);
  expect((screen.getByRole("combobox", { name: "Condition value" }) as HTMLInputElement).value).toBe("2");
});

test("IN takes several values as chips that can be removed", async () => {
  useStore.setState({ searchDraft: { op: "AND", children: [{ col: "public.orders.status", cmp: "IN", raw: "" }] } });
  render(<SearchPanel getValues={getValues} />);
  const value = screen.getByRole("combobox", { name: "Condition value" });
  fireEvent.focus(value);
  await waitFor(() => expect(opts("Condition value").length).toBe(3));
  fireEvent.mouseDown(opts("Condition value")[0]);
  fireEvent.focus(screen.getByRole("combobox", { name: "Condition value" }));
  await waitFor(() => expect(opts("Condition value").length).toBe(2));
  fireEvent.mouseDown(opts("Condition value")[0]);
  const d: any = useStore.getState().searchDraft;
  expect(d.children[0].raw).toBe("0,1");
  fireEvent.click(screen.getByRole("button", { name: "Remove 0" }));
  expect((useStore.getState().searchDraft as any).children[0].raw).toBe("1");
});

test("the shape controls build distinct, sort, limit, aggregates, group by and having", async () => {
  render(<SearchPanel getValues={getValues} />);
  const shape = () => useStore.getState().searchShape;
  fireEvent.click(screen.getByLabelText("Distinct"));
  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Aggregate" }));
  fireEvent.change(screen.getByLabelText("Aggregate function"), { target: { value: "SUM" } });
  const aggCol = screen.getByRole("combobox", { name: "Aggregate column" });
  fireEvent.focus(aggCol);
  fireEvent.change(aggCol, { target: { value: "orders total" } });
  fireEvent.mouseDown(opts("Aggregate column")[0]);
  fireEvent.click(screen.getByRole("button", { name: "+ Having" }));
  fireEvent.change(screen.getByLabelText("Having value"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Sort" }));
  const sort = screen.getByRole("combobox", { name: "Sort column" });
  fireEvent.focus(sort);
  fireEvent.mouseDown(opts("Sort column")[0]); // the aggregate comes first
  fireEvent.click(screen.getByRole("button", { name: "Sort direction" }));
  expect(shape()).toMatchObject({ distinct: true, limit: "25", aggregates: [{ func: "SUM", col: "public.orders.total" }], having: [{ agg: 0, cmp: ">", raw: "100" }], orderBy: [{ kind: "agg", agg: 0, dir: "DESC" }] });
});

test("Search is allowed with only an aggregate, and blocked while an import runs", () => {
  useStore.setState({ searchSelect: [] });
  const { rerender } = render(<SearchPanel getValues={getValues} />);
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  act(() => useStore.setState({ searchShape: { ...emptyShape(), aggregates: [{ func: "COUNT", col: "", alias: "" }] } }));
  rerender(<SearchPanel getValues={getValues} />);
  expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  act(() => useStore.setState({ importProgress: { stage: "Loading rows", percent: 10, message: "" } }));
  expect(screen.getByRole("button", { name: /Import running/ })).toBeDisabled();
});

test("a NOT group shows as pressed and bad limit text stops the search with a message", async () => {
  useStore.setState({ searchDraft: { op: "AND", children: [{ col: "public.users.email", cmp: "=", raw: "a" }] }, searchShape: { ...emptyShape(), limit: "ten" } });
  render(<SearchPanel getValues={getValues} />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle NOT" }));
  expect(screen.getByRole("button", { name: "Toggle NOT" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Limit must be a whole number");
});

test("a custom join is picked from two search boxes and used by the search", async () => {
  useStore.setState({ searchJoins: [] });
  render(<SearchPanel getValues={getValues} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Join" }));
  fireEvent.focus(screen.getByRole("combobox", { name: "Join 1 left column" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Join 1 left column" }), { target: { value: "orders status" } });
  fireEvent.mouseDown(opts("Join 1 left column")[0]);
  fireEvent.focus(screen.getByRole("combobox", { name: "Join 1 right column" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Join 1 right column" }), { target: { value: "users id" } });
  fireEvent.mouseDown(opts("Join 1 right column")[0]);
  expect(useStore.getState().searchJoins).toEqual([{ from: "public.orders.status", to: "public.users.id" }]);
  fireEvent.click(screen.getByRole("button", { name: "Remove join 1" }));
  expect(useStore.getState().searchJoins).toEqual([]);
});

test("a half-filled join stops the search with a message", async () => {
  useStore.setState({ searchJoins: [{ from: "public.orders.status", to: "" }] });
  render(<SearchPanel getValues={getValues} />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Join 1: pick both columns");
});
