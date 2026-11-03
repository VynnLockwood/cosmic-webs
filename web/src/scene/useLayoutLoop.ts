import { useEffect } from "react";
import { getCore } from "../core/coreClient";
import { useStore } from "../store/useStore";

const lastPositions = new Map<string, [number, number, number]>();

/** x,y,z per table of `graph` from the previous layout (NaN where the table is new). Exported for tests. */
export function initialPositions(names: string[], prev: Map<string, [number, number, number]>): Float32Array | undefined {
  if (!names.some((n) => prev.has(n))) return undefined;
  const out = new Float32Array(names.length * 3).fill(Number.NaN);
  names.forEach((n, i) => {
    const p = prev.get(n);
    if (p) out.set(p, i * 3);
  });
  return out;
}

/** Remember the latest positions of `names` and forget every other table, so the map cannot grow with each upload. */
export function rememberPositions(mem: Map<string, [number, number, number]>, names: string[], pos: ArrayLike<number>): void {
  const keep = new Set(names);
  for (const k of [...mem.keys()]) if (!keep.has(k)) mem.delete(k);
  names.forEach((n, i) => mem.set(n, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]));
}

/** Steps the WASM force layout in the worker until it settles, publishing positions to the store. */
export function useLayoutLoop() {
  const graph = useStore((s) => s.graph);
  useEffect(() => {
    if (!graph) return;
    let stop = false;
    (async () => {
      const core = getCore();
      useStore.getState().setLayoutSettled(false);
      await core.layoutNew(graph, 1, initialPositions(graph.tables.map((t) => t.name), lastPositions));
      while (!stop) {
        const pos = await core.layoutStep(3);
        if (stop) break; // a newer graph took over while this step ran: do not publish stale positions
        rememberPositions(lastPositions, graph.tables.map((t) => t.name), pos);
        useStore.getState().setPositions(pos);
        if (await core.layoutSettled()) {
          useStore.getState().setLayoutSettled(true);
          break;
        }
        await new Promise((r) => setTimeout(r, 16));
      }
    })().catch((e) => console.error("layout failed", e));
    return () => {
      stop = true;
    };
  }, [graph]);
}
