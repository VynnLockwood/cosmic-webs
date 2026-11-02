import type { SchemaGraph } from "../types";

export const DOT_COLORS = ["#7FD1FF", "#A98BFF", "#FF9EC7", "#7FFFD4", "#FFD27F", "#9EB4FF", "#FF8F7F", "#C6FF8F"];
export const COLORS = {
  void: "#05060F", violet: "#3B1E6B", teal: "#0F4C5C", rose: "#6B1E4A", star: "#F4F6FF",
  thread: "#8FA8FF", active: "#BFE4FF", red: "#FF5C6C", amber: "#FFC15C",
};
/** World-units scale applied to the spec radius so dots do not overlap the layout's link length. */
export const DOT_SCALE = 0.35;

export function dotRadius(rowEstimate: number, columnCount: number): number {
  return 2 + 3 * Math.log10((rowEstimate > 0 ? rowEstimate : columnCount) + 1);
}

/** Connected-component index per table, numbered by first appearance. */
export function components(g: SchemaGraph): number[] {
  const idx = new Map(g.tables.map((t, i) => [t.name, i]));
  const parent = g.tables.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const f of g.fks) {
    const a = idx.get(f.from.table), b = idx.get(f.to.table);
    if (a !== undefined && b !== undefined) parent[find(a)] = find(b);
  }
  const order = new Map<number, number>();
  return g.tables.map((_, i) => {
    const r = find(i);
    if (!order.has(r)) order.set(r, order.size);
    return order.get(r)!;
  });
}

export function clusterColors(g: SchemaGraph): string[] {
  return components(g).map((c) => DOT_COLORS[c % DOT_COLORS.length]);
}
export const clusterColor = (g: SchemaGraph, i: number) => clusterColors(g)[i];

export type DotState = "idle" | "hover" | "selected" | "path" | "required" | "flagged" | "dimmed";
export interface DotStyle { glow: number; pulse: boolean; ring: string | null; opacity: number }

export function dotStyle(s: DotState): DotStyle {
  switch (s) {
    case "hover": return { glow: 1.6, pulse: true, ring: null, opacity: 1 };
    case "selected": return { glow: 2, pulse: true, ring: COLORS.active, opacity: 1 };
    case "path": return { glow: 1.8, pulse: false, ring: null, opacity: 1 };
    case "required": return { glow: 1.8, pulse: false, ring: COLORS.active, opacity: 1 };
    case "flagged": return { glow: 0, pulse: true, ring: COLORS.red, opacity: 1 };
    case "dimmed": return { glow: 1, pulse: false, ring: null, opacity: 0.2 };
    default: return { glow: 1, pulse: true, ring: null, opacity: 1 };
  }
}

export type LinkState = "idle" | "neighbor" | "path" | "ambiguous";
export function linkStyle(s: LinkState): { opacity: number; dashed: boolean; color: string } {
  switch (s) {
    case "neighbor": return { opacity: 0.6, dashed: false, color: COLORS.thread };
    case "path": return { opacity: 0.9, dashed: false, color: COLORS.active };
    case "ambiguous": return { opacity: 0.9, dashed: true, color: COLORS.amber };
    default: return { opacity: 0.25, dashed: false, color: COLORS.thread };
  }
}
