import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Vector3 } from "three";
import { motion } from "./motion";

const N = 260;

/** Star streaks around the camera while it moves fast (app open, fly-in). */
export function Warp() {
  const camera = useThree((s) => s.camera);
  const { geo, seeds } = useMemo(() => {
    let s = 7;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(N * 6), 3));
    return { geo: g, seeds: Array.from({ length: N }, () => [r() * Math.PI * 2, 20 + r() * 160, 30 + r() * 500]) };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const v = useMemo(() => ({ f: new Vector3(), r: new Vector3(), u: new Vector3(), p: new Vector3() }), []);

  useFrame(() => {
    const w = motion.warp;
    if (w <= 0.001) return void (geo.drawRange.count = 0);
    geo.drawRange.count = N * 2;
    camera.getWorldDirection(v.f);
    v.r.crossVectors(v.f, camera.up).normalize();
    v.u.crossVectors(v.r, v.f).normalize();
    const pos = geo.getAttribute("position") as BufferAttribute;
    seeds.forEach(([a, rad, z], i) => {
      v.p.copy(camera.position).addScaledVector(v.f, z).addScaledVector(v.r, Math.cos(a) * rad).addScaledVector(v.u, Math.sin(a) * rad);
      pos.setXYZ(i * 2, v.p.x, v.p.y, v.p.z);
      v.p.addScaledVector(v.f, w * 90 * (0.4 + z / 500));
      pos.setXYZ(i * 2 + 1, v.p.x, v.p.y, v.p.z);
    });
    pos.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#BFD4FF" transparent opacity={0.45} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}
