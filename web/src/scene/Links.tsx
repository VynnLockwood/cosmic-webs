import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color } from "three";
import { useStore } from "../store/useStore";
import { motion } from "./camera/motion";
import { DOT_SCALE, dotRadius, linkStyle, type LinkState } from "./style";

const LOOP = 12;

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
  const segCount = links.reduce((n, l) => n + (l.a === l.b ? LOOP : 1), 0);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(segCount * 6), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(segCount * 6), 3));
    return g;
  }, [segCount]);
  const c = useMemo(() => new Color(), []);

  useFrame(() => {
    const { positions, hoveredTable, selectedTable, linkOverrides } = useStore.getState();
    if (positions.length !== graph.tables.length * 3) return;
    const pos = geo.getAttribute("position") as BufferAttribute;
    const col = geo.getAttribute("color") as BufferAttribute;
    const focus = [hoveredTable, selectedTable].filter(Boolean) as string[];
    let v = 0;
    for (const l of links) {
      const names = [graph.tables[l.a].name, graph.tables[l.b].name];
      const state: LinkState = linkOverrides[l.id] ?? (focus.some((f) => names.includes(f)) ? "neighbor" : "idle");
      const st = linkStyle(state);
      c.set(st.color).multiplyScalar(st.opacity * motion.linkFade);
      const k = motion.bang;
      const pa = [positions[l.a * 3] * k, positions[l.a * 3 + 1] * k, positions[l.a * 3 + 2] * k];
      const put = (p: number[]) => { pos.setXYZ(v, p[0], p[1], p[2]); col.setXYZ(v, c.r, c.g, c.b); v++; };
      if (l.a === l.b) {
        const r = dotRadius(graph.tables[l.a].row_estimate, graph.tables[l.a].columns.length) * DOT_SCALE * 1.6;
        for (let k = 0; k < LOOP; k++) {
          const a0 = (k / LOOP) * Math.PI * 2, a1 = ((k + 1) / LOOP) * Math.PI * 2;
          put([pa[0] + Math.cos(a0) * r, pa[1] + r + Math.sin(a0) * r, pa[2]]);
          put([pa[0] + Math.cos(a1) * r, pa[1] + r + Math.sin(a1) * r, pa[2]]);
        }
      } else {
        put(pa);
        put([positions[l.b * 3] * k, positions[l.b * 3 + 1] * k, positions[l.b * 3 + 2] * k]);
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
