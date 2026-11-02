import { useEffect, useState } from "react";
import { useStore } from "../../store/useStore";
import { E2E, perf } from "../e2eHook";
import { Dust } from "./Dust";
import { Effects } from "./Effects";
import { Nebula } from "./Nebula";
import { pickTier, TIERS, type Tier } from "./quality";
import { Stars } from "./Stars";

/** Active quality tier: user override, else measured fps over the first 3 s (fixed high in e2e runs). */
export function useTier(): Tier {
  const setting = useStore((s) => s.tier);
  const [auto, setAuto] = useState<Tier>("high");
  useEffect(() => {
    if (E2E) return;
    const h = setTimeout(() => setAuto(pickTier(perf.fps)), 3000);
    return () => clearTimeout(h);
  }, []);
  return setting === "auto" ? auto : setting;
}

export function Space() {
  const tier = useTier();
  return (
    <>
      <Nebula size={TIERS[tier].cubemap} />
      <Stars tier={tier} />
      <Dust count={TIERS[tier].dust} />
      <Effects tier={tier} />
    </>
  );
}
