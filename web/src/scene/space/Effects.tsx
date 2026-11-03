import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useStore } from "../../store/useStore";
import { E2E } from "../e2eHook";
import { TIERS, type Tier } from "./quality";

/** Bloom (glow), vignette, film grain; depth of field only during fly-in. */
export function Effects({ tier }: { tier: Tier }) {
  const spec = TIERS[tier];
  const flyingIn = useStore((s) => s.flyingIn);
  const effects = [
    spec.bloom !== "off" && <Bloom key="b" mipmapBlur luminanceThreshold={0.6} intensity={1.2} resolutionScale={spec.bloom === "half" ? 0.5 : 1} />,
    <Vignette key="v" darkness={0.5} offset={0.3} />,
    spec.grain && !E2E && <Noise key="n" opacity={0.03} />,
    spec.dof && flyingIn && <DepthOfField key="d" focusDistance={0.02} focalLength={0.05} bokehScale={2} />,
  ].filter(Boolean) as React.ReactElement[];
  return <EffectComposer multisampling={0}>{effects}</EffectComposer>;
}
