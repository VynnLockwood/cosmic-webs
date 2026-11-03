import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { loadSchema } from "../store/actions";
import { useStore } from "../store/useStore";
import { ImportProgress } from "./ImportProgress";
import { ApiError } from "../api/client";

const tiny = (rows: number) => ({ tables: [{ name: "public.a", schema: "public", columns: [], row_estimate: rows }], fks: [] });

beforeEach(() => useStore.setState({ graph: null, importProgress: null, importData: null, schemaError: null, warnings: [] }));

function fakeApi(states: any[]) {
  let i = 0;
  return {
    startSchemaJob: async () => ({ job_id: "j1", graph: tiny(0), warnings: [] }),
    getJob: async () => states[Math.min(i++, states.length - 1)],
    postSchema: async () => { throw new Error("must not be used"); },
    getDefaultSchema: async () => { throw new Error("x"); },
    connectLive: async () => { throw new Error("x"); },
    disconnectLive: async () => { throw new Error("x"); },
  } as any;
}

test("the parsed graph shows at once and progress follows until the finished graph replaces it", async () => {
  const done = { id: "j1", status: "done", stage: "Done", percent: 100, message: "", result: { graph: tiny(7), warnings: ["w"], data: { source: "mock", rows_loaded: 7, tables_with_data: 1, tables_empty: 0 } } };
  const api = fakeApi([{ id: "j1", status: "running", stage: "Loading rows", percent: 60, message: "public.a" }, done]);
  const seen: unknown[] = [];
  const unsub = useStore.subscribe((s) => seen.push(s.importProgress && { ...s.importProgress }));
  await act(() => loadSchema("create table a(id int);", { api }, { pollMs: 1 }));
  unsub();
  expect(seen.some((p: any) => p && p.stage === "Loading rows" && p.percent === 60)).toBe(true);
  const s = useStore.getState();
  expect(s.importProgress).toBeNull();
  expect(s.graph!.tables[0].row_estimate).toBe(7);
  expect(s.importData?.rows_loaded).toBe(7);
  expect(s.warnings).toEqual(["w"]);
});

test("a failed job clears the progress and shows the error", async () => {
  const api = fakeApi([{ id: "j1", status: "error", stage: "Loading rows", percent: 40, message: "", error: "RuntimeError: disk full" }]);
  await act(() => loadSchema("create table a(id int);", { api }, { pollMs: 1 }));
  expect(useStore.getState().importProgress).toBeNull();
  expect(useStore.getState().schemaError?.message).toContain("disk full");
});

test("a busy server (409) is reported and no progress is left behind", async () => {
  const api = { ...fakeApi([]), startSchemaJob: async () => { throw new ApiError(409, { message: "an import is already running, wait for it to finish" }); } };
  await act(() => loadSchema("x", { api }, { pollMs: 1 }));
  expect(useStore.getState().schemaError?.message).toContain("already running");
  expect(useStore.getState().importProgress).toBeNull();
});

test("the progress bar shows stage, table and percent, and renders nothing when idle", () => {
  const { container, rerender } = render(<ImportProgress />);
  expect(container).toBeEmptyDOMElement();
  act(() => useStore.setState({ importProgress: { stage: "Loading rows", percent: 42, message: "public.orders" } }));
  rerender(<ImportProgress />);
  const bar = screen.getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "42");
  expect(screen.getByText(/Loading rows/)).toBeInTheDocument();
  expect(screen.getByText(/public\.orders/)).toBeInTheDocument();
});
