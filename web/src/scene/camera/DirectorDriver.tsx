import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useStore } from "../../store/useStore";
import { cam } from "../cameraRef";
import { E2E } from "../e2eHook";
import { dotRadius, DOT_SCALE, type DotState } from "../style";
import { Director, flyInPose, frameSetPose, idleActive, IDLE_DEG_PER_S, type MoveKind, type Pose, type Vec3 } from "./director";
import { motion, motionActions } from "./motion";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const BANG_MS = 1500;

/** Runs camera moves, the opening burst, idle orbit and the motion actions (fly-in, back, frame). */
export function DirectorDriver() {
  const { camera } = useThree();
  const graph = useStore((s) => s.graph);
  const dir = useMemo(() => new Director(), []);
  const st = useRef({ lastInput: performance.now(), stack: [] as Pose[], bangStart: -1, opened: null as unknown, kindOnDone: null as null | (() => void) });
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3() }), []);
  const fov = () => (camera as PerspectiveCamera).fov ?? 55;
  const reduced = () => useStore.getState().reducedMotion;

  const pose = (): Pose => {
    const c = cam.controls!;
    return { position: c.getPosition(tmp.a).toArray() as Vec3, target: c.getTarget(tmp.b).toArray() as Vec3 };
  };
  const apply = (p: Pose) => cam.controls?.setLookAt(...p.position, ...p.target, false);
  const dotPos = (name: string): Vec3 | null => {
    const { graph: g, positions } = useStore.getState();
    const i = g?.tables.findIndex((t) => t.name === name) ?? -1;
    return i < 0 || positions.length < (i + 1) * 3 ? null : [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  };
  const allPoints = (): Vec3[] => {
    const p = useStore.getState().positions;
    const out: Vec3[] = [];
    for (let i = 0; i + 2 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
    return out;
  };
  const play = (kind: MoveKind, to: Pose, onDone?: () => void) => {
    if (!cam.controls) return;
    dir.cancel(performance.now());
    st.current.kindOnDone = onDone ?? null;
    dir.play(kind, to, { from: pose(), now: performance.now(), reduced: reduced() });
  };
  const clearFocus = () => useStore.getState().setOverrides({}, {});

  useEffect(() => {
    const s = useStore.getState;
    motionActions.flyToTable = (name) => {
      const g = s().graph;
      const p = dotPos(name);
      if (!g || !p) return;
      const t = g.tables.find((x) => x.name === name)!;
      if (st.current.stack.length === 0) st.current.stack.push(pose());
      s().selectTable(name);
      s().setPanelTable(null);
      s().setFlyingIn(true);
      const neighbors = new Set(g.fks.flatMap((f) => (f.from.table === name ? [f.to.table] : f.to.table === name ? [f.from.table] : [])));
      const dim: Record<string, DotState> = {};
      for (const x of g.tables) if (x.name !== name && !neighbors.has(x.name)) dim[x.name] = "dimmed";
      s().setOverrides(dim, {});
      play(name === "" ? "frameSet" : "flyIn", flyInPose(p, dotRadius(t.row_estimate, t.columns.length) * DOT_SCALE, pose().position), () => {
        s().setFlyingIn(false);
        s().setPanelTable(name);
      });
    };
    motionActions.back = () => {
      const home = st.current.stack.shift();
      st.current.stack = [];
      s().setPanelTable(null);
      s().selectTable(null);
      s().setFlyingIn(false);
      clearFocus();
      if (home) play("back", home);
    };
    motionActions.frameAll = () => play("frameSet", frameSetPose(allPoints(), fov()));
    motionActions.resetView = () => {
      st.current.stack = [];
      s().selectTable(null);
      s().setPanelTable(null);
      clearFocus();
      motionActions.frameAll();
    };
    motionActions.frameTables = (names) => {
      const pts = names.map(dotPos).filter(Boolean) as Vec3[];
      if (pts.length) play("frameSet", frameSetPose(pts, fov()));
    };
    motionActions.zoom = (d) => void cam.controls?.dolly(d * pose().position.reduce((a, b, i) => a + (b - pose().target[i]) ** 2, 0) ** 0.5 * 0.2, true);
    motionActions.rotate15 = (d) => void cam.controls?.rotate(({ left: -1, right: 1, up: 0, down: 0 }[d] * Math.PI) / 12, ({ left: 0, right: 0, up: -1, down: 1 }[d] * Math.PI) / 12, true);
  });

  useEffect(() => {
    const c = cam.controls;
    if (!c) return;
    const onStart = () => {
      st.current.lastInput = performance.now();
      if (dir.active) {
        dir.cancel(performance.now());
        motion.warp = 0;
        useStore.getState().setFlyingIn(false);
      }
    };
    c.addEventListener("controlstart", onStart);
    return () => c.removeEventListener("controlstart", onStart);
  }, []);

  // New graph: restart the opening burst and glide.
  useEffect(() => {
    if (!graph) return;
    st.current.opened = null;
    st.current.stack = [];
    st.current.bangStart = E2E || reduced() ? -1 : performance.now();
    motion.bang = st.current.bangStart < 0 ? 1 : 0;
    motion.linkFade = st.current.bangStart < 0 ? 1 : 0;
  }, [graph]);

  useFrame((_, dt) => {
    const c = cam.controls;
    if (!c) return;
    const now = performance.now();
    const s = st.current;
    if (s.bangStart >= 0) {
      const p = Math.min(1, (now - s.bangStart) / BANG_MS);
      motion.bang = easeOut(p);
      motion.linkFade = Math.min(1, Math.max(0, (p - 0.7) / 0.3));
      if (p >= 1) s.bangStart = -1;
    } else if (motion.bang < 1 && E2E) motion.bang = motion.linkFade = 1;

    const { graph: g, positions, layoutSettled } = useStore.getState();
    // browser tests frame the *settled* layout so the camera pose does not depend on frame timing
    if (g && s.opened !== g && positions.length === g.tables.length * 3 && (!E2E || layoutSettled)) {
      s.opened = g;
      const home = frameSetPose(allPoints(), fov());
      if (E2E) apply(home);
      else {
        const far: Pose = { position: home.position.map((v, i) => home.target[i] + (v - home.target[i]) * 5) as Vec3, target: home.target };
        apply(far);
        play("open", home);
      }
    }

    const sm = dir.sample(now);
    if (sm) {
      apply(sm.pose);
      const bell = Math.sin(Math.PI * sm.progress);
      motion.warp = E2E || reduced() ? 0 : sm.kind === "open" ? bell : sm.kind === "flyIn" ? bell * 0.6 : 0;
      if (sm.done) {
        motion.warp = 0;
        const cb = s.kindOnDone;
        s.kindOnDone = null;
        cb?.();
      }
    } else if (!E2E && idleActive(s.lastInput, now, reduced()) && g) {
      c.azimuthAngle += ((IDLE_DEG_PER_S * Math.PI) / 180) * dt;
    }
  });
  return null;
}
