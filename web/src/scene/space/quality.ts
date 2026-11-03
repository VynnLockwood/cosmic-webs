export type Tier = "high" | "medium" | "low";
export interface TierSpec { cubemap: number; stars: number; dust: number; bloom: "full" | "half" | "off"; dof: boolean; grain: boolean }

export const TIERS: Record<Tier, TierSpec> = {
  high: { cubemap: 2048, stars: 17100, dust: 250, bloom: "full", dof: true, grain: true },
  medium: { cubemap: 1024, stars: 8000, dust: 100, bloom: "half", dof: false, grain: false },
  low: { cubemap: 512, stars: 3000, dust: 0, bloom: "off", dof: false, grain: false },
};

/** Far shell / mid field / bright few. High is 14000 / 3000 / 100; other tiers scale proportionally. */
export function starCounts(t: Tier): { far: number; mid: number; bright: number } {
  const total = TIERS[t].stars;
  if (t === "high") return { far: 14000, mid: 3000, bright: 100 };
  const bright = Math.max(10, Math.round((100 * total) / 17100));
  const mid = Math.round(((total - bright) * 3000) / 17000);
  return { far: total - bright - mid, mid, bright };
}

/** Tier from average fps measured in the first 3 seconds. */
export function pickTier(avgFps: number): Tier {
  return avgFps >= 55 ? "high" : avgFps >= 35 ? "medium" : "low";
}
