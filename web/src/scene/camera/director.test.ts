import { Director, easeInOutCubic, flyInPose, frameSetPose, idleActive, IDLE_AFTER_MS, MOVE_MS, REDUCED_MS, type Pose, type Vec3 } from "./director";

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const P0: Pose = { position: [0, 0, 100], target: [0, 0, 0] };
const P1: Pose = { position: [100, 0, 0], target: [10, 0, 0] };

test("easeInOutCubic endpoints and midpoint", () => {
  expect(easeInOutCubic(0)).toBe(0);
  expect(easeInOutCubic(1)).toBe(1);
  expect(easeInOutCubic(0.5)).toBe(0.5);
});

test("flyInPose ends 3x radius from the dot", () => {
  const p = flyInPose([10, 20, 30], 4, [100, 50, -20]);
  expect(dist(p.position, [10, 20, 30])).toBeCloseTo(12, 6);
  expect(p.target).toEqual([10, 20, 30]);
});

test("frameSetPose keeps every point inside the view cone", () => {
  const pts: Vec3[] = [[-50, 10, 0], [60, -20, 30], [0, 70, -40], [10, 10, 80]];
  const fov = 55;
  const { position, target } = frameSetPose(pts, fov);
  const fwd = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const fl = Math.hypot(...fwd);
  for (const p of pts) {
    const v = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
    const cos = (v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2]) / (Math.hypot(...v) * fl);
    expect(Math.acos(cos)).toBeLessThan((fov / 2) * (Math.PI / 180));
  }
});

test("moves run for MOVE_MS and end exactly at the target", () => {
  const d = new Director();
  d.play("flyIn", P1, { from: P0, now: 1000, reduced: false });
  expect(d.sample(1000)!.pose.position).toEqual(P0.position);
  const end = d.sample(1000 + MOVE_MS.flyIn)!;
  expect(end.done).toBe(true);
  expect(end.pose.position[0]).toBeCloseTo(100, 6);
  expect(d.sample(1000 + MOVE_MS.flyIn + 1)).toBeNull();
});

test("retarget_starts_from_current_pose", () => {
  const d = new Director();
  d.play("flyIn", P1, { from: P0, now: 0, reduced: false });
  const mid = d.sample(300)!.pose;
  d.cancel(300);
  d.play("back", P0, { now: 300, reduced: false });
  expect(d.sample(300)!.pose.position).toEqual(mid.position);
});

test("idle_starts_after_20000ms_and_stops_on_input", () => {
  expect(idleActive(0, IDLE_AFTER_MS - 1, false)).toBe(false);
  expect(idleActive(0, IDLE_AFTER_MS, false)).toBe(true);
  expect(idleActive(IDLE_AFTER_MS, IDLE_AFTER_MS + 10, false)).toBe(false); // input at 20000 resets
  expect(idleActive(0, IDLE_AFTER_MS * 2, true)).toBe(false); // reduced motion
});

test("reduced_motion_duration_is_300", () => {
  const d = new Director();
  expect(d.durationFor("open", true)).toBe(REDUCED_MS);
  expect(d.durationFor("open", false)).toBe(MOVE_MS.open);
  expect(REDUCED_MS).toBe(300);
});
