import { pickTier, starCounts, TIERS } from "./quality";

test("TIERS match the visual spec table", () => {
  expect(TIERS.high).toEqual({ cubemap: 2048, stars: 17100, dust: 250, bloom: "full", dof: true, grain: true });
  expect(TIERS.medium).toEqual({ cubemap: 1024, stars: 8000, dust: 100, bloom: "half", dof: false, grain: false });
  expect(TIERS.low).toEqual({ cubemap: 512, stars: 3000, dust: 0, bloom: "off", dof: false, grain: false });
});

test("starCounts sums to the tier total; high is 6000/2500/60", () => {
  expect(starCounts("high")).toEqual({ far: 14000, mid: 3000, bright: 100 });
  for (const t of ["high", "medium", "low"] as const) {
    const c = starCounts(t);
    expect(c.far + c.mid + c.bright).toBe(TIERS[t].stars);
    expect(Math.min(c.far, c.mid, c.bright)).toBeGreaterThan(0);
  }
});

test("pickTier thresholds", () => {
  expect(pickTier(60)).toBe("high");
  expect(pickTier(55)).toBe("high");
  expect(pickTier(40)).toBe("medium");
  expect(pickTier(35)).toBe("medium");
  expect(pickTier(20)).toBe("low");
});

import { starColor } from "./Stars";

test("star colours cover the temperature range and are mostly white/blue-white", () => {
  const counts = { blue: 0, white: 0, warm: 0 };
  for (let i = 0; i < 1000; i++) {
    const [r, g, b] = starColor(i / 1000);
    if (r < 0.8) counts.blue++; else if (b >= 0.95) counts.white++; else counts.warm++;
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
  }
  expect(counts.blue).toBeGreaterThan(100);
  expect(counts.white).toBeGreaterThan(300);
  expect(counts.warm).toBeGreaterThan(200); // yellow, orange and red stars are present
});
