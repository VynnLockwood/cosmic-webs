import { create } from "zustand";
import type { DotState, LinkState } from "../scene/style";
import type { Draft } from "../ui/search/draft";
import type { Candidate, Flag, Ranked, SchemaError, SchemaGraph, SearchRequest } from "../types";

export type Drawer = "schema" | "source" | "search" | "results" | "settings" | null;
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
  fkChoices: Record<string, string>;
  setSearchSelect(v: string[]): void;
  setSearchDraft(d: Draft | null): void;
  setFkChoices(c: Record<string, string>): void;
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
  dotOverrides: {},
  linkOverrides: {},
  searchSelect: [],
  searchDraft: null,
  fkChoices: {},
  setSearchSelect: (searchSelect) => set({ searchSelect }),
  setSearchDraft: (searchDraft) => set({ searchDraft }),
  setFkChoices: (fkChoices) => set({ fkChoices }),
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
  setGraph: (graph) => set({ graph, selectedTable: null, hoveredTable: null, panelTable: null, layoutSettled: false, results: [], candidates: [], costs: {}, splitHidden: 0, flags: [], searchRequest: null, searchSelect: [], searchDraft: null, fkChoices: {}, dotOverrides: {}, linkOverrides: {} }),
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
