import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, DoubleSide, IcosahedronGeometry, InstancedMesh, Object3D, Sphere, Vector3 } from "three";
import { useStore } from "../store/useStore";
import { motion, motionActions } from "./camera/motion";
import { E2E } from "./e2eHook";
import { clusterColors, DOT_SCALE, dotRadius, dotStyle, type DotState } from "./style";

const HUGE = new Sphere(new Vector3(), 1e5);

export function Dots() {
  const graph = useStore((s) => s.graph)!;
  const n = graph.tables.length;
  const geo = useMemo(() => new IcosahedronGeometry(1, 2), []);
  const radii = useMemo(() => graph.tables.map((t) => dotRadius(t.row_estimate, t.columns.length) * DOT_SCALE), [graph]);
  const colors = useMemo(() => clusterColors(graph).map((c) => new Color(c)), [graph]);
  const core = useRef<InstancedMesh>(null!);
  const halo = useRef<InstancedMesh>(null!);
  const ring = useRef<InstancedMesh>(null!);
  const camera = useThree((s) => s.camera);
  const tmp = useMemo(() => ({ o: new Object3D(), c: new Color(), white: new Color("#F4F6FF"), none: new Color(0, 0, 0) }), []);

  useFrame(({ clock }) => {
    const { positions, hoveredTable, selectedTable, dotOverrides } = useStore.getState();
    if (positions.length !== n * 3 || !core.current) return;
    const t = clock.elapsedTime;
    const shimmer = Math.max(0, 1 - (performance.now() - useStore.getState().shimmerAt) / 600);
    for (let i = 0; i < n; i++) {
      const name = graph.tables[i].name;
      const state: DotState = dotOverrides[name] ?? (name === selectedTable ? "selected" : name === hoveredTable ? "hover" : "idle");
      const st = dotStyle(state);
      const pulse = st.pulse && !E2E ? 1 + 0.07 * Math.sin(t * 1.3 + i * 1.7) : 1;
      const r = radii[i] * pulse;
      const o = tmp.o;
      o.position.set(positions[i * 3] * motion.bang, positions[i * 3 + 1] * motion.bang, positions[i * 3 + 2] * motion.bang);
      o.quaternion.identity();
      o.scale.setScalar(r * 0.6);
      o.updateMatrix();
      core.current.setMatrixAt(i, o.matrix);
      core.current.setColorAt(i, tmp.c.copy(tmp.white).multiplyScalar(st.opacity));
      o.scale.setScalar(Math.max(r * 1.5 * st.glow * (1 + 0.8 * shimmer * Math.abs(Math.sin(t * 14 + i))), 1e-4));
      o.updateMatrix();
      halo.current.setMatrixAt(i, o.matrix);
      halo.current.setColorAt(i, tmp.c.copy(colors[i]).multiplyScalar(st.opacity));
      o.quaternion.copy(camera.quaternion);
      if (state === "selected") o.rotateZ(E2E ? 0 : t * 0.8);
      o.scale.setScalar(st.ring ? r * 1.9 : 1e-4);
      o.updateMatrix();
      ring.current.setMatrixAt(i, o.matrix);
      ring.current.setColorAt(i, st.ring ? tmp.c.set(st.ring) : tmp.none);
    }
    for (const m of [core, halo, ring]) {
      m.current.instanceMatrix.needsUpdate = true;
      if (m.current.instanceColor) m.current.instanceColor.needsUpdate = true;
      m.current.boundingSphere = HUGE;
    }
  });

  const setHover = useStore.getState().hoverTable;
  return (
    <group key={n}>
      <instancedMesh
        ref={core}
        args={[geo, undefined, n]}
        onPointerOver={(e) => (e.stopPropagation(), e.instanceId !== undefined && setHover(graph.tables[e.instanceId].name))}
        onPointerOut={() => setHover(null)}
        onClick={(e) => (e.stopPropagation(), e.instanceId !== undefined && motionActions.flyToTable(graph.tables[e.instanceId].name))}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[geo, undefined, n]} raycast={() => null}>
        <meshBasicMaterial transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={ring} args={[undefined, undefined, n]} raycast={() => null}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial transparent opacity={0.9} side={DoubleSide} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
