import type { SchemaGraph } from "../types";

export const DOT_COLORS = ["#7FD1FF", "#A98BFF", "#FF9EC7", "#7FFFD4", "#FFD27F", "#9EB4FF", "#FF8F7F", "#C6FF8F"];
export const COLORS = {
  void: "#05060F", violet: "#3B1E6B", teal: "#0F4C5C", rose: "#6B1E4A", star: "#F4F6FF",
  thread: "#8FA8FF", active: "#BFE4FF", red: "#FF5C6C", amber: "#FFC15C",
};
/** World-units scale applied to the spec radius so dots do not overlap the layout's link length. */
export const DOT_SCALE = 0.5;

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

/** Share of each pulse cycle during which the light is travelling along the link (the rest is idle). */
export const PULSE_FRACTION = 0.3;
/** Each link pulses every 3–8 s (deterministic per link). */
export const pulsePeriod = (link: number) => 3 + ((link * 37) % 51) / 10;
/** Position in the pulse cycle, [0,1). */
export function pulseCycle(link: number, tSec: number): number {
  const p = pulsePeriod(link);
  return (((tSec + link * 1.3) % p) + p) % p / p;
}
/** Extra brightness (0…1.4) of sub-segment `slot` of `slots` while a pulse passes (slot 0 = child end). */
export function pulseBoost(slot: number, slots: number, cycle: number): number {
  if (cycle >= PULSE_FRACTION) return 0;
  const pos = (cycle / PULSE_FRACTION) * slots;
  return Math.max(0, 1 - Math.abs(slot + 0.5 - pos) / 2.5) * 1.4;
}

/** Table label text: schema prefix dropped, long names shortened so labels do not pile up. */
export function labelText(name: string, max = 22): string {
  const n = name.replace(/^public\./, "");
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
}
