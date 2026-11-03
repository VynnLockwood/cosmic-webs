import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color } from "three";
import { useStore } from "../store/useStore";
import { motion } from "./camera/motion";
import { E2E } from "./e2eHook";
import { DOT_SCALE, dotRadius, linkStyle, pulseBoost, pulseCycle, type LinkState } from "./style";

const LOOP = 12;
const SLOTS = 16; // a link is drawn as 16 sub-segments so it can be dashed

export function Links() {
  const graph = useStore((s) => s.graph)!;
  const idx = useMemo(() => new Map(graph.tables.map((t, i) => [t.name, i])), [graph]);
  const links = useMemo(
    () => graph.fks.flatMap((f) => {
      const a = idx.get(f.from.table), b = idx.get(f.to.table);
      return a === undefined || b === undefined ? [] : [{ id: f.id, a, b }];
    }),
    [graph, idx],
  );
  const segCount = links.reduce((n, l) => n + (l.a === l.b ? LOOP : SLOTS), 0);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(segCount * 6), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(segCount * 6), 3));
    return g;
  }, [segCount]);
  useEffect(() => () => geo.dispose(), [geo]); // a new graph builds a new geometry: free the old one on the GPU
  const c = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const { positions, hoveredTable, selectedTable, linkOverrides, reducedMotion, visual } = useStore.getState();
    const pulses = !E2E && !reducedMotion;
    if (positions.length !== graph.tables.length * 3) return;
    const pos = geo.getAttribute("position") as BufferAttribute;
    const col = geo.getAttribute("color") as BufferAttribute;
    const focus = [hoveredTable, selectedTable].filter(Boolean) as string[];
    let v = 0;
    let li = -1;
    for (const l of links) {
      li++;
      const names = [graph.tables[l.a].name, graph.tables[l.b].name];
      const state: LinkState = linkOverrides[l.id] ?? (focus.some((f) => names.includes(f)) ? "neighbor" : "idle");
      const st = linkStyle(state);
      c.set(st.color).multiplyScalar(st.opacity * motion.linkFade * visual.webLine);
      const k = motion.bang;
      const pa = [positions[l.a * 3] * k, positions[l.a * 3 + 1] * k, positions[l.a * 3 + 2] * k];
      const put = (p: number[], boost = 0) => { pos.setXYZ(v, p[0], p[1], p[2]); col.setXYZ(v, c.r * (1 + 2.5 * boost), c.g * (1 + 2.5 * boost), c.b * (1 + 2.5 * boost)); v++; };
      if (l.a === l.b) {
        const r = dotRadius(graph.tables[l.a].row_estimate, graph.tables[l.a].columns.length) * DOT_SCALE * 1.6;
        for (let k = 0; k < LOOP; k++) {
          const a0 = (k / LOOP) * Math.PI * 2, a1 = ((k + 1) / LOOP) * Math.PI * 2;
          put([pa[0] + Math.cos(a0) * r, pa[1] + r + Math.sin(a0) * r, pa[2]]);
          put([pa[0] + Math.cos(a1) * r, pa[1] + r + Math.sin(a1) * r, pa[2]]);
        }
      } else {
        const pb = [positions[l.b * 3] * k, positions[l.b * 3 + 1] * k, positions[l.b * 3 + 2] * k];
        const at = (u: number) => [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u];
        for (let j = 0; j < SLOTS; j++) {
          // 16 sub-segments from child (u=0) to parent (u=1) so a light pulse can travel along the link; dashed links skip odd ones
          const drawn = !st.dashed || j % 2 === 0;
          const boost = pulses && drawn ? pulseBoost(j, SLOTS, pulseCycle(li, clock.elapsedTime)) : 0;
          const [u0, u1] = drawn ? [j / SLOTS, (j + 1) / SLOTS] : [0, 0];
          put(at(u0), boost);
          put(at(u1), boost);
        }
      }
    }
    pos.needsUpdate = col.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}
