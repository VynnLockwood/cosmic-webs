import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { BackSide, Color, CubeCamera, Mesh, Scene, ShaderMaterial, SphereGeometry, WebGLCubeRenderTarget } from "three";
import { COLORS } from "../style";

const vert = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const frag = /* glsl */ `
varying vec3 vDir;
uniform vec3 uVoid, uViolet, uTeal, uRose; uniform float uMaxLuma; uniform vec3 uSeed;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + vec3(7.1,3.7,1.3); a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float n1 = fbm(d*2.2 + uSeed), n2 = fbm(d*3.1 + vec3(11.,3.,5.) + uSeed), n3 = fbm(d*1.7 - uSeed);
  vec3 col = uVoid + uViolet*smoothstep(.35,.8,n1)*1.4 + uTeal*smoothstep(.4,.85,n2)*1.2 + uRose*smoothstep(.58,.9,n3)*.8;
  float lum = dot(col, vec3(.2126,.7152,.0722));
  if (lum > uMaxLuma) col *= uMaxLuma / lum;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Bakes the nebula once into a cubemap and uses it as the scene background: orientation is fixed in the world, so orbiting reveals new sky. */
export function Nebula({ size }: { size: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const rt = new WebGLCubeRenderTarget(size, { generateMipmaps: false });
    const geo = new SphereGeometry(10, 48, 24);
    const mat = new ShaderMaterial({
      side: BackSide, depthWrite: false, vertexShader: vert, fragmentShader: frag,
      uniforms: {
        uVoid: { value: new Color(COLORS.void) }, uViolet: { value: new Color(COLORS.violet) },
        uTeal: { value: new Color(COLORS.teal) }, uRose: { value: new Color(COLORS.rose) },
        uMaxLuma: { value: 0.18 }, uSeed: { value: [3.7, 1.9, 8.2] },
      },
    });
    const s = new Scene();
    s.add(new Mesh(geo, mat));
    new CubeCamera(0.1, 100, rt).update(gl, s);
    scene.background = rt.texture;
    return () => {
      scene.background = null;
      rt.dispose(); geo.dispose(); mat.dispose();
    };
  }, [gl, scene, size]);
  return null;
}
