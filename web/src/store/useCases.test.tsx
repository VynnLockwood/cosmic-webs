import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { UseCasesTab } from "../ui/UseCasesTab";
import { applyCase, deleteCase, openLastCase, renameCase, saveCurrentCase } from "./caseActions";
import { CASES_KEY, emptyBook, loadCases, normalizeCase } from "./useCases";
import { useStore } from "./useStore";
import { DEFAULT_VISUAL } from "./visualSettings";
import { emptyShape } from "../ui/search/shape";

const graph = { tables: [{ name: "public.orders", schema: "public", columns: [{ name: "id", type: "int" }, { name: "total", type: "numeric" }], row_estimate: 0 }], fks: [] } as any;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    graph, cases: emptyBook(), aiGoal: "", searchSelect: [], searchDraft: null, searchShape: emptyShape(), searchJoins: [], aiSql: [], fkChoices: {},
    visual: { ...DEFAULT_VISUAL }, sqlMode: "hardcoded", panelWidths: { drawer: null, panel: null }, tier: "auto", reducedMotion: false, drawer: "settings",
    ai: { apiKey: "sk-or-secret", model: "m/x" },
  });
});

const setup = () => useStore.setState({
  aiGoal: "paid per customer",
  searchSelect: ["public.orders.id", "public.orders.total"],
  searchDraft: { op: "AND", children: [{ col: "public.orders.total", cmp: ">", raw: "10" }] } as any,
  searchShape: { ...emptyShape(), limit: "20" },
  searchJoins: [{ from: "public.orders.id", to: "public.orders.total" }],
  aiSql: [{ title: "q", sql: "SELECT 1", params: [] }],
  visual: { ...DEFAULT_VISUAL, starSize: 1.7 }, sqlMode: "params", panelWidths: { drawer: 500, panel: null }, tier: "low", reducedMotion: true,
});

test("saving keeps the wish, builder, joins, AI SQL and settings in localStorage, and never the API key", () => {
  setup();
  const c = saveCurrentCase("Paid per customer")!;
  const raw = localStorage.getItem(CASES_KEY)!;
  expect(raw).not.toContain("sk-or-secret");
  const back = loadCases();
  expect(back.items).toHaveLength(1);
  expect(back.last).toBe(c.id);
  expect(back.items[0]).toMatchObject({ goal: "paid per customer", select: ["public.orders.id", "public.orders.total"], shape: { limit: "20" }, settings: { visual: { starSize: 1.7 }, sqlMode: "params", tier: "low", reducedMotion: true, panelWidths: { drawer: 500, panel: null } } });
  expect(back.items[0].joins).toHaveLength(1);
  expect(back.items[0].aiSql[0].sql).toBe("SELECT 1");
});

test("apply puts the whole case back, settings too", () => {
  setup();
  const c = saveCurrentCase("A")!;
  useStore.setState({ aiGoal: "", searchSelect: [], searchDraft: null, searchShape: emptyShape(), searchJoins: [], aiSql: [], visual: { ...DEFAULT_VISUAL }, sqlMode: "hardcoded", tier: "auto", reducedMotion: false, drawer: null });
  expect(applyCase(c.id, { openSearch: true })).toEqual({ missing: [] });
  const s = useStore.getState();
  expect(s.aiGoal).toBe("paid per customer");
  expect(s.searchSelect).toHaveLength(2);
  expect(s.searchShape.limit).toBe("20");
  expect(s.searchJoins).toHaveLength(1);
  expect(s.aiSql).toHaveLength(1);
  expect(s.visual.starSize).toBe(1.7);
  expect(s.sqlMode).toBe("params");
  expect(s.tier).toBe("low");
  expect(s.panelWidths.drawer).toBe(500);
  expect(s.drawer).toBe("search");
});

test("columns the open database lacks are left out and named", () => {
  setup();
  useStore.setState({ searchSelect: ["public.orders.id", "public.gone.x"] });
  const c = saveCurrentCase("B")!;
  expect(applyCase(c.id)).toEqual({ missing: ["public.gone.x"] });
  expect(useStore.getState().searchSelect).toEqual(["public.orders.id"]);
});

test("the same name replaces (any letter case); rename and delete work; a taken name is refused", () => {
  const a = saveCurrentCase("Mine")!;
  const again = saveCurrentCase("mine")!;
  expect(again.id).toBe(a.id);
  expect(useStore.getState().cases.items).toHaveLength(1);
  const b = saveCurrentCase("Other")!;
  expect(renameCase(b.id, "MINE")).toBe(false);
  expect(renameCase(b.id, "Third")).toBe(true);
  expect(saveCurrentCase("   ")).toBeNull();
  deleteCase(a.id);
  expect(loadCases().items.map((c) => c.name)).toEqual(["Third"]);
  expect(loadCases().last).toBe(b.id);
});

test("start-up opens the last used search but leaves your current settings alone; it can be switched off", () => {
  setup();
  saveCurrentCase("Last");
  useStore.setState({ aiGoal: "", searchSelect: [], visual: { ...DEFAULT_VISUAL, starSize: 0.5 } });
  openLastCase();
  expect(useStore.getState().aiGoal).toBe("paid per customer");
  expect(useStore.getState().visual.starSize).toBe(0.5);
  const b = useStore.getState().cases;
  useStore.setState({ cases: { ...b, autoOpen: false }, aiGoal: "" });
  openLastCase();
  expect(useStore.getState().aiGoal).toBe("");
});

test("broken saved data does not crash: junk is dropped, good parts stay", () => {
  localStorage.setItem(CASES_KEY, JSON.stringify({ items: [null, { id: 1 }, { id: "x", name: "ok", select: "no", settings: { tier: "weird", visual: { starSize: 99 } } }], last: "gone" }));
  const b = loadCases();
  expect(b.items).toHaveLength(1);
  expect(b.items[0].select).toEqual([]);
  expect(b.items[0].settings.tier).toBe("auto");
  expect(b.items[0].settings.visual.starSize).toBeLessThanOrEqual(2.5);
  expect(b.last).toBeNull();
  localStorage.setItem(CASES_KEY, "{not json");
  expect(loadCases()).toEqual(emptyBook());
  expect(normalizeCase("x")).toBeNull();
});

test("the tab: name it, save, apply, rename, delete", () => {
  setup();
  render(<UseCasesTab />);
  fireEvent.click(screen.getByRole("button", { name: "Save current as use case" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Give the use case a name");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paid" } });
  fireEvent.click(screen.getByRole("button", { name: "Save current as use case" }));
  const list = screen.getByRole("list", { name: "Saved use cases" });
  expect(within(list).getByText("Paid")).toBeInTheDocument();
  expect(within(list).getByText(/wish · 2 columns · filters · 1 join · 1 AI SQL · settings/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Rename Paid" }));
  fireEvent.change(screen.getByLabelText("New name for Paid"), { target: { value: "Paid v2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(within(list).getByText("Paid v2")).toBeInTheDocument();
  useStore.setState({ aiGoal: "", drawer: "settings" });
  fireEvent.click(screen.getByRole("button", { name: "Apply Paid v2" }));
  expect(useStore.getState().aiGoal).toBe("paid per customer");
  expect(useStore.getState().drawer).toBe("search");
  fireEvent.click(screen.getByRole("button", { name: "Delete Paid v2" }));
  expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
});
