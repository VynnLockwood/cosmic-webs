import { useEffect } from "react";
import { motionActions } from "../scene/camera/motion";
import { E2E } from "../scene/e2eHook";
import { useStore } from "../store/useStore";
import { planOverrides, requiredTables } from "./highlight";

/** Keeps dot/link highlighting in sync with the search: top plan by default, the hovered plan on hover. */
export function useSearchHighlight() {
  const graph = useStore((s) => s.graph);
  const req = useStore((s) => s.searchRequest);
  const results = useStore((s) => s.results);
  const candidates = useStore((s) => s.candidates);
  const flags = useStore((s) => s.flags);
  const choices = useStore((s) => s.fkChoices);
  const hover = useStore((s) => s.hoverPlan);
  const reduced = useStore((s) => s.reducedMotion);

  // Frame the required tables once per search.
  useEffect(() => {
    if (req && graph) motionActions.frameTables(requiredTables(req));
  }, [results, flags]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!graph || !req) return;
    const id = hover ?? results[0]?.id;
    const cand = candidates.find((c) => c.id === id) ?? null;
    const o = planOverrides(graph, cand, requiredTables(req), flags, choices);
    const { setOverrides } = useStore.getState();
    const ids = Object.keys(o.links).filter((k) => o.links[k] === "path");
    if (hover || E2E || reduced || ids.length < 2) return setOverrides(o.dots, o.links);
    // light the path one link at a time, in join order
    const upTo = (n: number) => Object.fromEntries(Object.entries(o.links).filter(([k, v]) => v !== "path" || ids.indexOf(k) < n));
    const timers = ids.map((_, i) => window.setTimeout(() => setOverrides(o.dots, upTo(i + 1)), 140 * (i + 1)));
    setOverrides(o.dots, upTo(0));
    return () => timers.forEach(clearTimeout);
  }, [graph, req, results, candidates, flags, choices, hover, reduced]);
}
