import { useEffect } from "react";
import { getCore } from "../core/coreClient";
import { useStore } from "../store/useStore";

/** Steps the WASM force layout in the worker until it settles, publishing positions to the store. */
export function useLayoutLoop() {
  const graph = useStore((s) => s.graph);
  useEffect(() => {
    if (!graph) return;
    let stop = false;
    (async () => {
      const core = getCore();
      await core.layoutNew(graph, 1);
      while (!stop) {
        useStore.getState().setPositions(await core.layoutStep(3));
        if (await core.layoutSettled()) break;
        await new Promise((r) => setTimeout(r, 16));
      }
    })().catch((e) => console.error("layout failed", e));
    return () => {
      stop = true;
    };
  }, [graph]);
}
