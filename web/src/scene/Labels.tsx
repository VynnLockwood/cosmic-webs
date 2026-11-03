import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { useStore } from "../store/useStore";
import { motion } from "./camera/motion";
import { labelText } from "./style";

const NEAREST = 8;
/** Labels sit below the UI layer (z-index 5) so they never draw over panels. */
const Z_RANGE: [number, number] = [4, 0];

function Label({ index, name, strong }: { index: number; name: string; strong: boolean }) {
  const group = useRef<Group>(null!);
  const div = useRef<HTMLDivElement>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const p = useStore.getState().positions;
    if (p.length < (index + 1) * 3) return;
    group.current.position.set(p[index * 3] * motion.bang, p[index * 3 + 1] * motion.bang, p[index * 3 + 2] * motion.bang);
    if (div.current) {
      const d = camera.position.distanceTo(group.current.position);
      div.current.style.opacity = String(strong ? 1 : Math.max(0, Math.min(0.75, 1 - (d - 80) / 260)));
    }
  });
  return (
    <group ref={group}>
      <Html center zIndexRange={Z_RANGE} style={{ pointerEvents: "none", transform: "translate(0, -22px)" }}>
        <div ref={div} style={{ whiteSpace: "nowrap", fontSize: 11, color: "#E6E9FF", textShadow: "0 0 6px #05060F", fontWeight: strong ? 600 : 400 }}>
          {labelText(name)}
        </div>
      </Html>
    </group>
  );
}

/** Table names: hovered, selected, and the 12 dots nearest the camera. */
export function Labels() {
  const graph = useStore((s) => s.graph)!;
  const hovered = useStore((s) => s.hoveredTable);
  const selected = useStore((s) => s.selectedTable);
  const camera = useThree((s) => s.camera);
  const [near, setNear] = useState<number[]>([]);
  useEffect(() => {
    const tick = () => {
      const p = useStore.getState().positions;
      if (p.length !== graph.tables.length * 3) return;
      const d = graph.tables.map((_, i) => [i, (p[i * 3] - camera.position.x) ** 2 + (p[i * 3 + 1] - camera.position.y) ** 2 + (p[i * 3 + 2] - camera.position.z) ** 2]);
      d.sort((a, b) => a[1] - b[1]);
      setNear(d.slice(0, NEAREST).map((x) => x[0]));
    };
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [graph, camera]);
  const idx = new Set(near);
  for (const n of [hovered, selected]) if (n) idx.add(graph.tables.findIndex((t) => t.name === n));
  return (
    <>
      {[...idx].filter((i) => i >= 0).map((i) => (
        <Label key={i} index={i} name={graph.tables[i].name} strong={graph.tables[i].name === hovered || graph.tables[i].name === selected} />
      ))}
    </>
  );
}
