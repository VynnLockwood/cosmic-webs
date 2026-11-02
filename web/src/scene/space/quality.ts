export type Tier = "high" | "medium" | "low";
export interface TierSpec { cubemap: number; stars: number; dust: number; bloom: "full" | "half" | "off"; dof: boolean; grain: boolean }

export const TIERS: Record<Tier, TierSpec> = {
  high: { cubemap: 2048, stars: 8560, dust: 400, bloom: "full", dof: true, grain: true },
  medium: { cubemap: 1024, stars: 4000, dust: 150, bloom: "half", dof: false, grain: false },
  low: { cubemap: 512, stars: 1500, dust: 0, bloom: "off", dof: false, grain: false },
};

/** Far shell / mid field / bright few. High is 6000 / 2500 / 60; other tiers scale proportionally. */
export function starCounts(t: Tier): { far: number; mid: number; bright: number } {
  const total = TIERS[t].stars;
  if (t === "high") return { far: 6000, mid: 2500, bright: 60 };
  const bright = Math.max(10, Math.round((60 * total) / 8560));
  const mid = Math.round(((total - bright) * 2500) / 8500);
  return { far: total - bright - mid, mid, bright };
}

/** Tier from average fps measured in the first 3 seconds. */
export function pickTier(avgFps: number): Tier {
  return avgFps >= 55 ? "high" : avgFps >= 35 ? "medium" : "low";
}
