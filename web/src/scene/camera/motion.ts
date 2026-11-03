/** Shared per-frame motion state (read by the scene, written by the director) plus action entry points. */
export const motion = {
  /** 0 → 1 "big bang" expansion factor applied to dot positions */
  bang: 1,
  /** link opacity multiplier (links fade in after the burst) */
  linkFade: 1,
  /** warp-streak intensity 0 → 1 */
  warp: 0,
};

export type Dir = "left" | "right" | "up" | "down";
export const motionActions = {
  flyToTable: (_name: string) => {},
  back: () => {},
  frameAll: () => {},
  frameTables: (_names: string[]) => {},
  resetView: () => {},
  zoom: (_dir: 1 | -1) => {},
  rotate15: (_dir: Dir) => {},
};
