import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { ApiError } from "../api/client";
import { SchemaPanel } from "../ui/SchemaPanel";
import { forgetDatabase, loadSchema, restoreDatabase } from "./actions";
import { clearDatabase, loadDatabase, saveDatabase } from "./dbStore";
import { useStore } from "./useStore";

const g = (name: string) => ({ tables: [{ name: `public.${name}`, schema: "public", columns: [], row_estimate: 0 }], fks: [] });
const calls: string[] = [];
const api = (over: any = {}) => ({
  postSchema: async (ddl: string) => { calls.push(ddl); if (ddl.includes("BAD")) throw new ApiError(422, { message: "syntax error", line: 1, col: 1 }); return { graph: g("mine"), warnings: [] }; },
  getDefaultSchema: async () => { calls.push("DEFAULT"); return { graph: g("default"), warnings: [] }; },
  connectLive: async () => { throw new Error("x"); },
  disconnectLive: async () => { throw new Error("x"); },
  ...over,
}) as any;

beforeEach(async () => {
  calls.length = 0;
  localStorage.clear();
  await clearDatabase();
  useStore.setState({ graph: null, schemaError: null, warnings: [], savedDb: null, rememberDb: true, useDumpData: true });
});

test("a good import is saved; on the next start it loads by itself, no paste", async () => {
  await act(() => loadSchema("CREATE TABLE mine (id int);", { api: api() }));
  expect((await loadDatabase())?.ddl).toBe("CREATE TABLE mine (id int);");
  expect(useStore.getState().savedDb?.bytes).toBe(27);
  // new visit
  useStore.setState({ graph: null, savedDb: null });
  calls.length = 0;
  await act(() => restoreDatabase({ api: api() }));
  expect(calls).toEqual(["CREATE TABLE mine (id int);"]);
  expect(useStore.getState().graph?.tables[0].name).toBe("public.mine");
});

test("nothing saved: the default database loads", async () => {
  await act(() => restoreDatabase({ api: api() }));
  expect(calls).toEqual(["DEFAULT"]);
});

test("an import that fails is not saved, and the earlier saved one stays", async () => {
  await saveDatabase("CREATE TABLE old (id int);", true);
  await act(() => loadSchema("BAD", { api: api() }));
  expect((await loadDatabase())?.ddl).toBe("CREATE TABLE old (id int);");
});

test("with 'remember' off nothing is saved", async () => {
  useStore.getState().setRememberDb(false);
  expect(localStorage.getItem("cosmos.rememberDb")).toBe("no");
  await act(() => loadSchema("CREATE TABLE mine (id int);", { api: api() }));
  expect(await loadDatabase()).toBeNull();
});

test("a saved copy that no longer loads falls back to the default and says why; the copy is kept", async () => {
  await saveDatabase("BAD", true);
  await act(() => restoreDatabase({ api: api() }));
  expect(calls).toEqual(["BAD", "DEFAULT"]);
  expect(useStore.getState().graph?.tables[0].name).toBe("public.default");
  expect(useStore.getState().warnings[0]).toContain("syntax error");
  expect((await loadDatabase())?.ddl).toBe("BAD");
});

test("the saved choice about rows in the file comes back too", async () => {
  await saveDatabase("CREATE TABLE mine (id int);", false);
  await act(() => restoreDatabase({ api: api() }));
  expect(useStore.getState().useDumpData).toBe(false);
});

test("the panel shows what is saved, and Forget it removes it but keeps the web on screen", async () => {
  await act(() => loadSchema("CREATE TABLE mine (id int);", { api: api() }));
  render(<SchemaPanel />);
  expect(screen.getByRole("status", { name: "Saved database" })).toHaveTextContent("Saved in this browser: 1 KB");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Forget it" })); });
  expect(await loadDatabase()).toBeNull();
  expect(screen.queryByRole("status", { name: "Saved database" })).toBeNull();
  expect(useStore.getState().graph).not.toBeNull();
});

test("forgetDatabase on an empty store is fine", async () => {
  await forgetDatabase();
  expect(useStore.getState().savedDb).toBeNull();
});
