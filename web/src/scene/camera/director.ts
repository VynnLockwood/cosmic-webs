// Pure camera-motion logic: eased, interruptible moves between poses.
export type Vec3 = [number, number, number];
export interface Pose { position: Vec3; target: Vec3 }
export type MoveKind = "open" | "bang" | "flyIn" | "back" | "frameSet" | "flag";

export const MOVE_MS: Record<MoveKind, number> = { open: 2200, bang: 1500, flyIn: 1100, back: 900, frameSet: 1200, flag: 1100 };
export const REDUCED_MS = 300;
export const IDLE_AFTER_MS = 20000;
export const IDLE_DEG_PER_S = 0.6;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Position follows an arc (bulges sideways) and the target eases linearly; t in [0,1] is already eased. */
export function arcPose(from: Pose, to: Pose, e: number, arc = true): Pose {
  const d = sub(to.position, from.position);
  let p = add(from.position, mul(d, e));
  if (arc) {
    let side = cross(d, [0, 1, 0]);
    if (len(side) < 1e-6) side = [1, 0, 0];
    p = add(p, mul(norm(side), Math.sin(Math.PI * e) * 0.2 * len(d)));
  }
  return { position: p, target: add(from.target, mul(sub(to.target, from.target), e)) };
}

/** Ends 3x the dot radius away, on the side the camera is already on. */
export function flyInPose(dot: Vec3, radius: number, cameraPos: Vec3): Pose {
  const dir = norm(sub(cameraPos, dot));
  return { position: add(dot, mul(dir, 3 * radius)), target: dot };
}

/** A pose from which the bounding sphere of `points` fits in the view. */
export function frameSetPose(points: Vec3[], fovDeg: number, viewDir: Vec3 = [0, 0.25, 1]): Pose {
  const n = points.length || 1;
  const c = mul(points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / n);
  const r = Math.max(5, ...points.map((p) => len(sub(p, c))));
  const dist = (r / Math.sin((fovDeg / 2) * (Math.PI / 180))) * 1.15;
  return { position: add(c, mul(norm(viewDir), dist)), target: c };
}

export function idleActive(lastInputMs: number, nowMs: number, reduced: boolean): boolean {
  return !reduced && nowMs - lastInputMs >= IDLE_AFTER_MS;
}

export interface Sample { pose: Pose; done: boolean; kind: MoveKind; progress: number }

export class Director {
  private move: { kind: MoveKind; from: Pose; to: Pose; start: number; ms: number; reduced: boolean } | null = null;
  private last: Pose | null = null;

  durationFor(kind: MoveKind, reduced: boolean) {
    return reduced ? REDUCED_MS : MOVE_MS[kind];
  }

  /** `from` defaults to where the previous move was cancelled (so a retarget never jumps). */
  play(kind: MoveKind, to: Pose, o: { from?: Pose; now: number; reduced: boolean }) {
    const from = o.from ?? this.last;
    if (!from) throw new Error("play() needs a starting pose");
    this.move = { kind, from, to, start: o.now, ms: this.durationFor(kind, o.reduced), reduced: o.reduced };
  }

  get active() {
    return this.move !== null;
  }

  sample(now: number): Sample | null {
    const m = this.move;
    if (!m) return null;
    const progress = Math.min(1, Math.max(0, (now - m.start) / m.ms));
    const e = easeInOutCubic(progress);
    const pose = progress >= 1 ? m.to : arcPose(m.from, m.to, e, !m.reduced);
    this.last = pose;
    if (progress >= 1) this.move = null;
    return { pose, done: progress >= 1, kind: m.kind, progress };
  }

  cancel(now: number) {
    if (this.move) this.sample(now);
    this.move = null;
  }
}
