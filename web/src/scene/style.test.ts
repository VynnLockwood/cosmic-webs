import type { SchemaGraph } from "../types";
import { clusterColor, DOT_COLORS, dotRadius, dotStyle, linkStyle } from "./style";

const t = (name: string) => ({ name, columns: [], row_estimate: 0 });

test("dotRadius uses rows, falls back to column count", () => {
  expect(dotRadius(1000, 5)).toBeCloseTo(2 + 3 * Math.log10(1001));
  expect(dotRadius(0, 5)).toBeCloseTo(2 + 3 * Math.log10(6));
});

test("dotStyle values from the visual spec", () => {
  expect(dotStyle("dimmed").opacity).toBe(0.2);
  expect(dotStyle("selected").glow).toBe(2);
  expect(dotStyle("hover").glow).toBe(1.6);
  expect(dotStyle("path")).toMatchObject({ glow: 1.8, pulse: false });
  expect(dotStyle("flagged")).toMatchObject({ glow: 0, ring: "#FF5C6C" });
  expect(dotStyle("idle")).toMatchObject({ glow: 1, pulse: true, opacity: 1 });
});

test("linkStyle opacities", () => {
  expect(linkStyle("idle").opacity).toBe(0.25);
  expect(linkStyle("neighbor").opacity).toBe(0.6);
  expect(linkStyle("path").opacity).toBe(0.9);
  expect(linkStyle("ambiguous")).toMatchObject({ dashed: true, color: "#FFC15C" });
});

test("clusterColor wraps after 8 components", () => {
  const g: SchemaGraph = { tables: Array.from({ length: 9 }, (_, i) => t(`public.t${i}`)), fks: [] };
  expect(clusterColor(g, 0)).toBe(DOT_COLORS[0]);
  expect(clusterColor(g, 8)).toBe(DOT_COLORS[0]);
  expect(clusterColor(g, 1)).toBe(DOT_COLORS[1]);
});

test("clusterColor groups linked tables", () => {
  const g: SchemaGraph = {
    tables: [t("public.a"), t("public.b"), t("public.c")],
    fks: [{ id: "f", from: { table: "public.a", columns: ["x"] }, to: { table: "public.b", columns: ["id"] } }],
  };
  expect(clusterColor(g, 0)).toBe(clusterColor(g, 1));
  expect(clusterColor(g, 2)).not.toBe(clusterColor(g, 0));
});

import { pulseBoost, pulseCycle, pulsePeriod, PULSE_FRACTION } from "./style";

test("link pulse travels child → parent every 3–8 s", () => {
  for (let i = 0; i < 200; i++) {
    expect(pulsePeriod(i)).toBeGreaterThanOrEqual(3);
    expect(pulsePeriod(i)).toBeLessThanOrEqual(8);
    expect(pulseCycle(i, 12.3)).toBeGreaterThanOrEqual(0);
    expect(pulseCycle(i, 12.3)).toBeLessThan(1);
    expect(pulseCycle(i, 5)).toBeCloseTo(pulseCycle(i, 5 + pulsePeriod(i)), 6);
  }
  expect(pulseBoost(8, 16, PULSE_FRACTION)).toBe(0); // idle part of the cycle
  expect(pulseBoost(8, 16, 0.5)).toBe(0);
  const mid = pulseBoost(8, 16, PULSE_FRACTION / 2); // pulse is halfway along the link
  expect(mid).toBeGreaterThan(pulseBoost(2, 16, PULSE_FRACTION / 2));
  expect(mid).toBeGreaterThan(1);
});
