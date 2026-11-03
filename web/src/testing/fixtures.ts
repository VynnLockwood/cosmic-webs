import type { Metric, Ranked } from "../types";

const zero: Metric = { value: 0, best: 0, worst: 0, norm: 0, weight: 0, points: 0 };

/** A Ranked with a valid (all-zero) score sheet; override what a test cares about. */
export function ranked(id: string, over: Partial<Ranked> = {}): Ranked {
  return {
    id, score: 0, breakdown: { cost: 0, joins: 0, queries: 0, rows: 0 }, reason: "", metric: "cost", compared: 1,
    detail: { cost: zero, queries: zero, joins: zero, rows: zero }, ...over,
  };
}
