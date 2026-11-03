import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { BackSide, CubeCamera, HalfFloatType, Mesh, Scene, ShaderMaterial, SphereGeometry, WebGLCubeRenderTarget } from "three";

const vert = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const frag = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSeed; uniform float uMaxLuma;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + vec3(7.1,3.7,1.3); a *= .5; } return s; }
// ridged, self-masking noise: thin bright filaments like a supernova remnant
float ridged(vec3 p){
  float a = .5, s = 0., w = 1.;
  for(int i=0;i<6;i++){ float n = 1.0 - abs(2.0*noise(p) - 1.0); n *= n; s += a*n*w; w = clamp(n*1.6, 0.0, 1.0); p = p*2.07 + vec3(3.1,1.7,5.3); a *= .5; }
  return s;
}
// One nebula object: a warped filament shell (red/orange/amber) around a soft cyan core, on black.
vec3 nebula(vec3 d, vec3 c, float radius, float seed){
  float t = acos(clamp(dot(d, c), -1.0, 1.0)) / radius;
  if (t > 1.8) return vec3(0.0);
  vec3 s = vec3(seed, seed*1.7, seed*2.3);
  vec3 p = (d - c) / radius * 1.7;
  p += (vec3(fbm(p*1.3+s), fbm(p*1.3+s+7.1), fbm(p*1.3+s+13.7)) - .5) * 1.4;
  float fil = ridged(p*1.6 + s);
  float body = smoothstep(0.95, .12, t), halo = smoothstep(1.8, .6, t), core = smoothstep(.6, .0, t);
  vec3 red = vec3(.80,.14,.08), orange = vec3(1.0,.40,.10), amber = vec3(1.0,.62,.28), cyan = vec3(.20,.62,1.0);
  vec3 col = mix(red, orange, smoothstep(.2,.6,fil)) * fil*fil * body * 1.9;
  col += amber * pow(fil, 4.0) * body * 0.75;
  col += cyan * core*core * (.35 + .65*fbm(p*2.0+s)) * .7;
  col += red * halo * fil * .07;
  return col;
}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0012, 0.0016, 0.0035);                    // near-black sky
  float haze = fbm(d*1.6 + uSeed);                            // very faint cold haze for depth
  col += vec3(.05,.06,.14) * smoothstep(.45,.9,haze) * .05;
  float lum = dot(col, vec3(.2126,.7152,.0722));
  if (lum > uMaxLuma) col *= uMaxLuma / lum;
  col += nebula(d, normalize(vec3( .75,  .25, -.60)), .24, 3.7);
  col += nebula(d, normalize(vec3(-.80, -.30,  .50)), .30, 8.2);
  col += nebula(d, normalize(vec3( .10,  .80,  .55)), .20, 1.3);
  col += nebula(d, normalize(vec3(-.30,  .20, -.90)), .15, 5.5) * .8;
  col += (hash(d*937.1) - .5) * (1.0/255.0);                    // dither
  gl_FragColor = vec4(col, 1.0);
}`;

/** Bakes the sky (black, with a few filamentary nebulae) once into a cubemap and uses it as the scene background: orientation is fixed in the world, so orbiting reveals new sky. */
export function Nebula({ size }: { size: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const rt = new WebGLCubeRenderTarget(size, { generateMipmaps: false, type: HalfFloatType }) // float target: no banding in the dark gradients;
    const geo = new SphereGeometry(10, 48, 24);
    const mat = new ShaderMaterial({
      side: BackSide, depthWrite: false, vertexShader: vert, fragmentShader: frag,
      uniforms: {
        uMaxLuma: { value: 0.03 }, uSeed: { value: [3.7, 1.9, 8.2] },
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
