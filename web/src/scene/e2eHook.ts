import type { SearchRequest } from "../types";

const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?e2e=1` freezes twinkle, pulses and idle orbit so screenshots are deterministic. */
export const E2E = q.has("e2e");
/** `?e2e=1&sky=only` hides dots, links and UI. */
export const SKY_ONLY = q.get("sky") === "only";

export const perf = { fps: 60 };
export const hook: {
  dotCount: number;
  linkCount: number;
  cameraPose: () => { pos: number[]; target: number[] };
  orbitTo: (azimuthDeg: number) => void;
  fps: () => number;
  lastRequest: () => SearchRequest | null;
  [k: string]: unknown;
} = {
  dotCount: 0,
  linkCount: 0,
  cameraPose: () => ({ pos: [0, 0, 0], target: [0, 0, 0] }),
  orbitTo: () => {},
  fps: () => perf.fps,
  lastRequest: () => null,
};
if (E2E && typeof window !== "undefined") (window as any).__cosmos = hook;
