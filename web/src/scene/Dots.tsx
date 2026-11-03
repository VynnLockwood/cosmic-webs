import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, DoubleSide, IcosahedronGeometry, InstancedMesh, Object3D, PlaneGeometry, ShaderMaterial, Sphere, Vector3 } from "three";
import { useStore } from "../store/useStore";
import { motion, motionActions } from "./camera/motion";
import { E2E } from "./e2eHook";
import { clusterColors, DOT_SCALE, dotRadius, dotStyle, type DotState } from "./style";

const HUGE = new Sphere(new Vector3(), 1e5);

/** Star sprite: white-hot core, soft halo, four long diffraction spikes and four faint short ones (like a telescope photo). */
const STAR_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vColor;
void main() {
  vUv = position.xy;
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#else
  vColor = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = /* glsl */ `
varying vec2 vUv; varying vec3 vColor;
void main() {
  vec2 p = vUv;
  float r = length(p);
  float core = exp(-r * r * 260.0);
  float halo = exp(-r * 11.0) * 0.5;
  float h = exp(-abs(p.y) * 70.0) * pow(max(0.0, 1.0 - abs(p.x)), 2.0);
  float v = exp(-abs(p.x) * 70.0) * pow(max(0.0, 1.0 - abs(p.y)), 2.0);
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
  float d = (exp(-abs(q.y) * 120.0) * pow(max(0.0, 1.0 - abs(q.x)), 3.5) + exp(-abs(q.x) * 120.0) * pow(max(0.0, 1.0 - abs(q.y)), 3.5)) * 0.22;
  float k = max(max(vColor.r, vColor.g), vColor.b);
  vec3 col = vColor * halo + vec3(k) * (core * 1.5 + (h + v) * 0.85 + d);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Cluster colour washed toward white: stars are mostly white with a hint of blue, violet or warm. */
const pastel = (c: Color) => c.clone().lerp(new Color("#FFFFFF"), 0.62);

export function Dots() {
  const graph = useStore((s) => s.graph)!;
  const n = graph.tables.length;
  const geo = useMemo(() => new IcosahedronGeometry(1, 2), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const radii = useMemo(() => graph.tables.map((t) => dotRadius(t.row_estimate, t.columns.length) * DOT_SCALE), [graph]);
  const colors = useMemo(() => clusterColors(graph).map((c) => pastel(new Color(c))), [graph]);
  const starMat = useMemo(() => new ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => starMat.dispose(), [starMat]);
  const starGeo = useMemo(() => new PlaneGeometry(2, 2), []);
  useEffect(() => () => starGeo.dispose(), [starGeo]);
  const core = useRef<InstancedMesh>(null!);
  const halo = useRef<InstancedMesh>(null!);
  const ring = useRef<InstancedMesh>(null!);
  const camera = useThree((s) => s.camera);
  const tmp = useMemo(() => ({ o: new Object3D(), c: new Color(), white: new Color("#F4F6FF"), none: new Color(0, 0, 0) }), []);

  useFrame(({ clock }) => {
    const { positions, hoveredTable, selectedTable, dotOverrides, visual } = useStore.getState();
    if (positions.length !== n * 3 || !core.current) return;
    const t = clock.elapsedTime;
    const shimmer = Math.max(0, 1 - (performance.now() - useStore.getState().shimmerAt) / 600);
    for (let i = 0; i < n; i++) {
      const name = graph.tables[i].name;
      const state: DotState = dotOverrides[name] ?? (name === selectedTable ? "selected" : name === hoveredTable ? "hover" : "idle");
      const st = dotStyle(state);
      const pulse = st.pulse && !E2E ? 1 + 0.07 * Math.sin(t * 1.3 + i * 1.7) : 1;
      const r = radii[i] * pulse * visual.starSize;
      const o = tmp.o;
      o.position.set(positions[i * 3] * motion.bang, positions[i * 3 + 1] * motion.bang, positions[i * 3 + 2] * motion.bang);
      o.quaternion.identity();
      o.scale.setScalar(r * 0.34);
      o.updateMatrix();
      core.current.setMatrixAt(i, o.matrix);
      core.current.setColorAt(i, tmp.c.copy(tmp.white).multiplyScalar(st.opacity * Math.min(visual.brightness, 1.2)));
      o.quaternion.copy(camera.quaternion);
      o.scale.setScalar(Math.max(r * 5.6 * st.glow * (1 + 0.8 * shimmer * Math.abs(Math.sin(t * 14 + i))), 1e-4));
      o.updateMatrix();
      halo.current.setMatrixAt(i, o.matrix);
      halo.current.setColorAt(i, tmp.c.copy(colors[i]).multiplyScalar(st.opacity * visual.brightness));
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
      <instancedMesh ref={halo} args={[starGeo, starMat, n]} raycast={() => null} />
      <instancedMesh ref={ring} args={[undefined, undefined, n]} raycast={() => null}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial transparent opacity={0.9} side={DoubleSide} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
