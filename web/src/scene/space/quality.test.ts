import { pickTier, starCounts, TIERS } from "./quality";

test("TIERS match the visual spec table", () => {
  expect(TIERS.high).toEqual({ cubemap: 2048, stars: 8560, dust: 400, bloom: "full", dof: true, grain: true });
  expect(TIERS.medium).toEqual({ cubemap: 1024, stars: 4000, dust: 150, bloom: "half", dof: false, grain: false });
  expect(TIERS.low).toEqual({ cubemap: 512, stars: 1500, dust: 0, bloom: "off", dof: false, grain: false });
});

test("starCounts sums to the tier total; high is 6000/2500/60", () => {
  expect(starCounts("high")).toEqual({ far: 6000, mid: 2500, bright: 60 });
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
