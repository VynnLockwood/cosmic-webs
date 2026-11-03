import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, ShaderMaterial } from "three";
import { E2E } from "../e2eHook";
import type { Tier } from "./quality";
import { starCounts } from "./quality";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vert = /* glsl */ `
attribute float aSize; attribute float aPhase; attribute float aFreq; attribute vec3 aColor;
uniform float uTime, uPx, uTwinkle; varying float vA; varying vec3 vC;
void main(){
  vA = 1.0 - 0.25 * uTwinkle * (0.5 + 0.5*sin(uTime*aFreq*6.2831853 + aPhase));
  vC = aColor;
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const frag = /* glsl */ `
uniform float uFlare; varying float vA; varying vec3 vC;
void main(){
  vec2 p = gl_PointCoord - .5; float r = length(p);
  float a = smoothstep(.5, .0, r); a *= a;
  if (uFlare > .5) a = max(a, max(smoothstep(.03,.0,abs(p.x))*smoothstep(.5,.0,abs(p.y)), smoothstep(.03,.0,abs(p.y))*smoothstep(.5,.0,abs(p.x)))*.7);
  gl_FragColor = vec4(vC, a*vA);
}`;

function layer(count: number, seed: number, place: (r: () => number) => [number, number, number], size: [number, number]) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3), s = new Float32Array(count), ph = new Float32Array(count), fq = new Float32Array(count), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = place(r);
    pos.set(p, i * 3);
    s[i] = size[0] + r() * (size[1] - size[0]);
    ph[i] = r() * Math.PI * 2;
    fq[i] = 0.3 + r() * 1.2;
    const tint = r();
    col.set(tint < 0.2 ? [0.7, 0.8, 1] : tint > 0.85 ? [1, 0.9, 0.75] : [0.96, 0.97, 1], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aSize", new BufferAttribute(s, 1));
  g.setAttribute("aPhase", new BufferAttribute(ph, 1));
  g.setAttribute("aFreq", new BufferAttribute(fq, 1));
  g.setAttribute("aColor", new BufferAttribute(col, 3));
  return g;
}

const onSphere = (radius: number) => (r: () => number): [number, number, number] => {
  const u = r() * 2 - 1, t = r() * Math.PI * 2, k = Math.sqrt(1 - u * u);
  return [Math.cos(t) * k * radius, u * radius, Math.sin(t) * k * radius];
};
const inShell = (lo: number, hi: number) => (r: () => number): [number, number, number] => onSphere(lo + r() * (hi - lo))(r);

function mat(flare: boolean, px: number) {
  return new ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: px }, uTwinkle: { value: E2E ? 0 : 1 }, uFlare: { value: flare ? 1 : 0 } },
  });
}

/** Far + bright stars are fixed to the sky (follow the camera position); mid stars have real positions for parallax. */
export function Stars({ tier }: { tier: Tier }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const sky = useRef<Group>(null!);
  const parts = useMemo(() => {
    const c = starCounts(tier);
    return [
      { g: layer(c.far, 1, onSphere(4000), [0.6, 1.2]), m: mat(false, dpr), follow: true },
      { g: layer(c.bright, 2, onSphere(3800), [3, 5]), m: mat(true, dpr), follow: true },
      { g: layer(c.mid, 3, inShell(600, 1500), [1, 2.5]), m: mat(false, dpr), follow: false },
    ];
  }, [tier, dpr]);
  useFrame(({ clock }) => {
    sky.current.position.copy(camera.position);
    for (const p of parts) p.m.uniforms.uTime.value = E2E ? 0 : clock.elapsedTime;
  });
  return (
    <>
      <group ref={sky}>{parts.filter((p) => p.follow).map((p, i) => <points key={i} geometry={p.g} material={p.m} frustumCulled={false} />)}</group>
      {parts.filter((p) => !p.follow).map((p, i) => <points key={i} geometry={p.g} material={p.m} frustumCulled={false} />)}
    </>
  );
}
