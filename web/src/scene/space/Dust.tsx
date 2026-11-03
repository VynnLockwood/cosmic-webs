import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial } from "three";
import { E2E } from "../e2eHook";

const vert = /* glsl */ `
attribute float aPhase; uniform float uTime, uPx; varying float vA;
void main(){
  vec3 p = position + vec3(sin(uTime*.05+aPhase), cos(uTime*.04+aPhase*1.7), sin(uTime*.03+aPhase*2.3)) * 8.0;
  vA = 0.025 + 0.03 * fract(aPhase * 7.0);
  gl_PointSize = 3.0 * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
}`;
const frag = /* glsl */ `varying float vA; void main(){ float r = length(gl_PointCoord-.5); gl_FragColor = vec4(.7,.78,1., smoothstep(.5,.0,r)*vA); }`;

/** Soft drifting motes near the web; strong parallax when the camera flies through. */
export function Dust({ count }: { count: number }) {
  const { geo, mat } = useMemo(() => {
    let s = 99;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pos = new Float32Array(count * 3), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const rad = 50 + r() * 650, u = r() * 2 - 1, t = r() * Math.PI * 2, k = Math.sqrt(1 - u * u);
      pos.set([Math.cos(t) * k * rad, u * rad, Math.sin(t) * k * rad], i * 3);
      ph[i] = r() * 100;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aPhase", new BufferAttribute(ph, 1));
    const m = new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uTime: { value: 0 }, uPx: { value: 1 } } });
    return { geo: g, mat: m };
  }, [count]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }) => { mat.uniforms.uTime.value = E2E ? 0 : clock.elapsedTime; });
  if (count === 0) return null;
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
