import { create } from "zustand";
import type { DotState, LinkState } from "../scene/style";
import type { Flag, Ranked, SchemaGraph, SearchRequest } from "../types";

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
  flags: Flag[];
  tier: TierSetting;
  reducedMotion: boolean;
  /** per-table / per-fk visual overrides set by search, flags and fly-in */
  dotOverrides: Record<string, DotState>;
  linkOverrides: Record<string, LinkState>;
  setOverrides(d: Record<string, DotState>, l: Record<string, LinkState>): void;
  setGraph(g: SchemaGraph): void;
  setPositions(p: Float32Array): void;
  selectTable(name: string | null): void;
  hoverTable(name: string | null): void;
  setDrawer(d: Drawer): void;
  setSourceMode(m: "sandbox" | "live"): void;
  setSearch(req: SearchRequest | null): void;
  setResults(results: Ranked[], flags: Flag[]): void;
  setTier(t: TierSetting): void;
  setReducedMotion(v: boolean): void;
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
  flags: [],
  tier: "auto",
  dotOverrides: {},
  linkOverrides: {},
  setOverrides: (dotOverrides, linkOverrides) => set({ dotOverrides, linkOverrides }),
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  setGraph: (graph) => set({ graph, selectedTable: null, hoveredTable: null, results: [], flags: [], searchRequest: null, dotOverrides: {}, linkOverrides: {} }),
  setPositions: (positions) => set({ positions }),
  selectTable: (selectedTable) => set({ selectedTable }),
  hoverTable: (hoveredTable) => set({ hoveredTable }),
  setDrawer: (drawer) => set({ drawer }),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  setSearch: (searchRequest) => set({ searchRequest }),
  setResults: (results, flags) => set({ results, flags }),
  setTier: (tier) => set({ tier }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
