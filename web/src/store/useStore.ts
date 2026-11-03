import { create } from "zustand";
import type { DotState, LinkState } from "../scene/style";
import type { Draft } from "../ui/search/draft";
import type { ChangeEntry } from "./exportScripts";
import { emptyShape, type ShapeDraft } from "../ui/search/shape";
import type { ImportProgressInfo, Candidate, Experiment, ImportData, IndexInfo, Flag, Suggestion, Ranked, SchemaError, SchemaGraph, SearchRequest } from "../types";

export type Drawer = "schema" | "source" | "structure" | "search" | "results" | "settings" | null;
/** how SQL is shown and copied: with $1 bind parameters, or with the values written in */
export type SqlMode = "params" | "hardcoded";
const SQLMODE_KEY = "cosmos.sqlMode";
export function loadSqlMode(): SqlMode {
  try { return localStorage.getItem(SQLMODE_KEY) === "params" ? "params" : "hardcoded"; } catch { return "hardcoded"; }
}

export interface PanelWidths { drawer: number | null; panel: number | null }
const WIDTHS_KEY = "cosmos.widths";
/** Saved panel widths (null = default). A broken saved value is ignored. */
export function loadWidths(): PanelWidths {
  try {
    const v = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? "");
    const ok = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return { drawer: ok(v?.drawer), panel: ok(v?.panel) };
  } catch {
    return { drawer: null, panel: null };
  }
}

export type TierSetting = "auto" | "high" | "medium" | "low";

export interface State {
  graph: SchemaGraph | null;
  positions: Float32Array;
  selectedTable: string | null;
  hoveredTable: string | null;
  sourceMode: "sandbox" | "live";
  drawer: Drawer;
  searchRequest: SearchRequest | null;
  results: Ranked[];
  /** candidate shown highlighted on hover in the results list */
  hoverPlan: string | null;
  setHoverPlan(id: string | null): void;
  candidates: Candidate[];
  costs: Record<string, { total_cost: number; plan_rows: number; exec_ms?: number | null }>;
  splitHidden: number;
  measureTime: boolean;
  includeSplit: boolean;
  setSearchOptions(o: { measureTime?: boolean; includeSplit?: boolean }): void;
  flags: Flag[];
  tier: TierSetting;
  sqlMode: SqlMode;
  setSqlMode(m: SqlMode): void;
  /** widths the user dragged the side panels to (null = default) */
  panelWidths: PanelWidths;
  setPanelWidth(k: keyof PanelWidths, w: number | null): void;
  reducedMotion: boolean;
  /** per-table / per-fk visual overrides set by search, flags and fly-in */
  dotOverrides: Record<string, DotState>;
  linkOverrides: Record<string, LinkState>;
  /** table whose detail panel is open (set when the fly-in arrives) */
  panelTable: string | null;
  setPanelTable(n: string | null): void;
  /** search builder state (kept here so closing the drawer does not lose it) */
  searchSelect: string[];
  searchDraft: Draft | null;
  /** DISTINCT / sort / limit / aggregates / group / having as typed */
  searchShape: ShapeDraft;
  setSearchShape(s: ShapeDraft): void;
  fkChoices: Record<string, string>;
  setSearchSelect(v: string[]): void;
  setSearchDraft(d: Draft | null): void;
  setFkChoices(c: Record<string, string>): void;
  /** structure lab */
  indexes: IndexInfo[];
  suggestions: Suggestion[];
  suggestionsSource: "dump" | "mock" | "live" | null;
  experiments: Experiment[];
  structureBusy: boolean;
  structureError: string | null;
  lastExecuted: string[];
  /** every change made in the structure lab this session (for the changes script) */
  changeLog: ChangeEntry[];
  /** set by replaceGraph: the next graph keeps camera and layout (no opening animation) */
  keepView: boolean;
  replaceGraph(g: SchemaGraph): void;
  patchStructure(p: Partial<Pick<State, "indexes" | "suggestions" | "suggestionsSource" | "experiments" | "structureBusy" | "structureError" | "lastExecuted" | "changeLog">>): void;
  importData: ImportData | null;
  /** set while a schema import runs in the background (null when idle) */
  importProgress: ImportProgressInfo | null;
  /** use the rows of an uploaded dump when it has any (otherwise mock rows are generated) */
  useDumpData: boolean;
  setUseDumpData(v: boolean): void;
  schemaError: SchemaError | null;
  liveError: string | null;
  warnings: string[];
  /** performance.now() of the last data-source switch (drives the 0.6 s shimmer) */
  shimmerAt: number;
  layoutSettled: boolean;
  setLayoutSettled(v: boolean): void;
  flyingIn: boolean;
  setFlyingIn(v: boolean): void;
  setOverrides(d: Record<string, DotState>, l: Record<string, LinkState>): void;
  setGraph(g: SchemaGraph): void;
  setPositions(p: Float32Array): void;
  selectTable(name: string | null): void;
  hoverTable(name: string | null): void;
  setDrawer(d: Drawer): void;
  setSourceMode(m: "sandbox" | "live"): void;
  setSearch(req: SearchRequest | null): void;
  setResults(results: Ranked[], flags: Flag[], extra?: { candidates?: Candidate[]; costs?: Record<string, { total_cost: number; plan_rows: number; exec_ms?: number | null }>; splitHidden?: number }): void;
  setTier(t: TierSetting): void;
  setReducedMotion(v: boolean): void;
}

/** `?tier=low|medium|high` forces a quality tier (used by browser tests). */
function initialTier(): TierSetting {
  const t = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tier") : null;
  return t === "low" || t === "medium" || t === "high" ? t : "auto";
}

export const useStore = create<State>((set) => ({
  graph: null,
  positions: new Float32Array(0),
  selectedTable: null,
  hoveredTable: null,
  sourceMode: "sandbox",
  drawer: null,
  searchRequest: null,
  results: [],
  hoverPlan: null,
  setHoverPlan: (hoverPlan) => set({ hoverPlan }),
  candidates: [],
  costs: {},
  splitHidden: 0,
  measureTime: true,
  includeSplit: false,
  setSearchOptions: (o) => set(o),
  flags: [],
  tier: initialTier(),
  sqlMode: loadSqlMode(),
  setSqlMode: (sqlMode) => {
    try { localStorage.setItem(SQLMODE_KEY, sqlMode); } catch { /* private mode */ }
    set({ sqlMode });
  },
  panelWidths: loadWidths(),
  setPanelWidth: (k, w) =>
    set((s) => {
      const panelWidths = { ...s.panelWidths, [k]: w };
      try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(panelWidths)); } catch { /* private mode: keep it for this visit only */ }
      return { panelWidths };
    }),
  dotOverrides: {},
  linkOverrides: {},
  searchSelect: [],
  searchDraft: null,
  searchShape: emptyShape(),
  setSearchShape: (searchShape) => set({ searchShape }),
  fkChoices: {},
  setSearchSelect: (searchSelect) => set({ searchSelect }),
  setSearchDraft: (searchDraft) => set({ searchDraft }),
  setFkChoices: (fkChoices) => set({ fkChoices }),
  indexes: [],
  suggestions: [],
  suggestionsSource: null,
  experiments: [],
  structureBusy: false,
  structureError: null,
  lastExecuted: [],
  changeLog: [],
  keepView: false,
  replaceGraph: (graph) =>
    set((s) => ({
      graph, keepView: true, hoveredTable: null, dotOverrides: {}, linkOverrides: {},
      selectedTable: graph.tables.some((t) => t.name === s.selectedTable) ? s.selectedTable : null,
      panelTable: graph.tables.some((t) => t.name === s.panelTable) ? s.panelTable : null,
    })),
  patchStructure: (p) => set(p),
  importData: null,
  importProgress: null,
  useDumpData: true,
  setUseDumpData: (useDumpData) => set({ useDumpData }),
  schemaError: null,
  liveError: null,
  warnings: [],
  shimmerAt: -1e9,
  layoutSettled: false,
  setLayoutSettled: (layoutSettled) => set({ layoutSettled }),
  panelTable: null,
  setPanelTable: (panelTable) => set({ panelTable }),
  flyingIn: false,
  setFlyingIn: (flyingIn) => set({ flyingIn }),
  setOverrides: (dotOverrides, linkOverrides) => set({ dotOverrides, linkOverrides }),
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  setGraph: (graph) => set({ graph, selectedTable: null, hoveredTable: null, panelTable: null, layoutSettled: false, results: [], candidates: [], costs: {}, splitHidden: 0, flags: [], searchRequest: null, searchSelect: [], searchDraft: null, searchShape: emptyShape(), fkChoices: {}, experiments: [], indexes: [], suggestions: [], suggestionsSource: null, structureError: null, lastExecuted: [], changeLog: [], dotOverrides: {}, linkOverrides: {} }),
  setPositions: (positions) => set({ positions }),
  selectTable: (selectedTable) => set({ selectedTable }),
  hoverTable: (hoveredTable) => set({ hoveredTable }),
  setDrawer: (drawer) => set({ drawer }),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  setSearch: (searchRequest) => set({ searchRequest }),
  setResults: (results, flags, extra) => set({ results, flags, candidates: extra?.candidates ?? [], costs: extra?.costs ?? {}, splitHidden: extra?.splitHidden ?? 0 }),
  setTier: (tier) => set({ tier }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
