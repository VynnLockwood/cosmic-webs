/** How the sky looks and feels; edited in Settings and kept in this browser's localStorage. */
export interface VisualSettings {
  /** multiplier on every star's size (spikes included) */
  starSize: number;
  /** multiplier on star light */
  brightness: number;
  /** multiplier on the brightness of the web lines (0 hides them) */
  webLine: number;
  /** mouse / touch drag speed and the slow idle spin */
  spin: number;
}

export const DEFAULT_VISUAL: VisualSettings = { starSize: 1, brightness: 1, webLine: 1, spin: 1 };
export const RANGES: Record<keyof VisualSettings, [number, number]> = {
  starSize: [0.4, 2.5],
  brightness: [0.3, 2],
  webLine: [0, 2.5],
  spin: [0.2, 3],
};
export const VISUAL_KEY = "cosmos.visual";

const clamp = (k: keyof VisualSettings, v: unknown): number => {
  const [lo, hi] = RANGES[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_VISUAL[k];
};

export const normalizeVisual = (v: Partial<Record<keyof VisualSettings, unknown>> | null | undefined): VisualSettings => ({
  starSize: clamp("starSize", v?.starSize),
  brightness: clamp("brightness", v?.brightness),
  webLine: clamp("webLine", v?.webLine),
  spin: clamp("spin", v?.spin),
});

/** Saved settings, each value checked on its own; anything broken falls back to the default. */
export function loadVisual(): VisualSettings {
  try {
    return normalizeVisual(JSON.parse(localStorage.getItem(VISUAL_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_VISUAL };
  }
}

export function saveVisual(v: VisualSettings): void {
  try { localStorage.setItem(VISUAL_KEY, JSON.stringify(v)); } catch { /* private mode: the choice lasts for this visit */ }
}

export function clearVisual(): void {
  try { localStorage.removeItem(VISUAL_KEY); } catch { /* ignore */ }
}
