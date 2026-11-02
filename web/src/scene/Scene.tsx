import { CameraControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { useStore } from "../store/useStore";
import { cam, type Controls } from "./cameraRef";
import { Dots } from "./Dots";
import { hook, perf, SKY_ONLY } from "./e2eHook";
import { Labels } from "./Labels";
import { Links } from "./Links";
import { Space } from "./space/Space";
import { COLORS } from "./style";
import { useLayoutLoop } from "./useLayoutLoop";

function Probe() {
  const graph = useStore((s) => s.graph);
  useEffect(() => {
    hook.dotCount = graph?.tables.length ?? 0;
    hook.linkCount = graph?.fks.length ?? 0;
    hook.cameraPose = () => {
      const c = cam.controls!;
      const p = c.getPosition(new Vector3());
      const t = c.getTarget(new Vector3());
      return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
    };
    hook.orbitTo = (deg) => void cam.controls?.rotateAzimuthTo((deg * Math.PI) / 180, false);
  }, [graph]);
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
  return <CameraControls ref={ref} makeDefault dampingFactor={0.08} />;
}

export default function Scene() {
  useLayoutLoop();
  const graph = useStore((s) => s.graph);
  return (
    <Canvas camera={{ position: [0, 40, 220], fov: 55, near: 0.1, far: 12000 }} dpr={[1, 2]} onPointerMissed={() => useStore.getState().selectTable(null)}>
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
      <Probe />
    </Canvas>
  );
}
