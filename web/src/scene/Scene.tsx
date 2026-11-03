import { CameraControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { useStore } from "../store/useStore";
import { cam, type Controls } from "./cameraRef";
import { DirectorDriver } from "./camera/DirectorDriver";
import { motionActions } from "./camera/motion";
import { Warp } from "./camera/Warp";
import { Dots } from "./Dots";
import { hook, perf, SKY_ONLY } from "./e2eHook";
import { Labels } from "./Labels";
import { Links } from "./Links";
import { Space } from "./space/Space";
import { COLORS, DOT_SCALE, dotRadius } from "./style";
import { useLayoutLoop } from "./useLayoutLoop";

function Probe() {
  const graph = useStore((s) => s.graph);
  const { camera, size, gl } = useThree();
  useEffect(() => {
    hook.dotCount = graph?.tables.length ?? 0;
    hook.linkCount = graph?.fks.length ?? 0;
    hook.cameraPose = () => {
      const c = cam.controls!;
      const p = c.getPosition(new Vector3());
      const t = c.getTarget(new Vector3());
      return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
    };
    hook.dotScreen = (name: string) => {
      const { graph: g, positions } = useStore.getState();
      const i = g!.tables.findIndex((t) => t.name === name);
      const v = new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    hook.dotWorld = (name: string) => {
      const { graph: g, positions } = useStore.getState();
      const i = g!.tables.findIndex((t) => t.name === name);
      return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    };
    hook.dotRadius = (name: string) => {
      const t = useStore.getState().graph!.tables.find((x) => x.name === name)!;
      return dotRadius(t.row_estimate, t.columns.length) * DOT_SCALE;
    };
    hook.state = () => { const { selectedTable, panelTable, hoveredTable, flyingIn, layoutSettled } = useStore.getState(); return { selectedTable, panelTable, hoveredTable, flyingIn, layoutSettled }; };
    hook.lastRequest = () => useStore.getState().searchRequest;
    hook.gpu = () => ({ ...gl.info.memory, programs: gl.info.programs?.length ?? 0 });
    hook.setStore = (patch: Record<string, unknown>) => useStore.setState(patch as never);
    hook.orbitTo = (deg) => void cam.controls?.rotateAzimuthTo((deg * Math.PI) / 180, false);
  }, [graph, camera, size]);
  useFrame((_, dt) => {
    perf.fps = perf.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  });
  return null;
}

function Rig() {
  const ref = useRef<Controls>(null);
  useEffect(() => {
    cam.controls = ref.current;
    return () => {
      cam.controls = null;
    };
  }, []);
  const spin = useStore((s) => s.visual.spin);
  return <CameraControls ref={ref} makeDefault dampingFactor={0.08} azimuthRotateSpeed={spin} polarRotateSpeed={spin} />;
}

export default function Scene() {
  useLayoutLoop();
  const graph = useStore((s) => s.graph);
  return (
    <Canvas camera={{ position: [0, 40, 220], fov: 55, near: 0.1, far: 12000 }} dpr={[1, 2]} onPointerMissed={() => (useStore.getState().selectedTable ? motionActions.back() : undefined)}>
      <color attach="background" args={[COLORS.void]} />
      <Rig />
      {graph && !SKY_ONLY && (
        <>
          <Links />
          <Dots />
          <Labels />
        </>
      )}
      <Space />
      <Warp />
      <DirectorDriver />
      <Probe />
    </Canvas>
  );
}
