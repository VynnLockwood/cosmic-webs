import { api as realApi, type Api } from "../api/client";
import { runSearch as realSearch, type SearchOutcome } from "../search/runSearch";
import type { Experiment, SearchRequest, StructureOp } from "../types";
import { useStore } from "./useStore";

interface Deps {
  api: Pick<Api, "applyStructure" | "refill" | "getStructure">;
  search: (req: SearchRequest) => Promise<SearchOutcome>;
}
const real: Deps = { api: realApi, search: (req) => realSearch(req) };

const cols = (c: string[]) => c.join(", ");
const short = (t: string) => t.replace(/^public\./, "");

/** Short human description of a change, used as the experiment label. */
export function describeOp(op: StructureOp): string {
  switch (op.kind) {
    case "create_index": return `+ ${op.unique ? "unique " : ""}index ${short(op.table)}(${cols(op.columns)})`;
    case "drop_index": return `− index ${op.name}`;
    case "add_fk": return `+ FK ${short(op.table)}(${cols(op.columns)}) → ${short(op.ref_table)}(${cols(op.ref_columns)})`;
    case "drop_fk": return `− FK ${op.name}`;
    case "add_column": return `+ column ${short(op.table)}.${op.name} ${op.type}`;
    case "drop_column": return `− column ${short(op.table)}.${op.name}`;
    case "sql": return op.statement.replace(/\s+/g, " ").slice(0, 60);
  }
}

/** The best plan of a search, reduced to what the comparison table shows. */
export function experimentFrom(id: number, label: string, out: Pick<SearchOutcome, "ranked" | "candidates" | "flags">): Experiment {
  const r = out.ranked[0];
  const cand = r && out.candidates.find((c) => c.id === r.id);
  return {
    id, label, plans: r?.compared ?? 0, flags: out.flags.length,
    best: r && cand ? { id: r.id, shape: cand.shape, joins: cand.joins, queries: cand.query_count, value: r.detail.cost.value, metric: r.metric, score: r.score, sql: cand.queries.map((q) => q.sql).join(";\n") } : null,
  };
}

/** Change of the best plan versus the baseline, in percent (negative = better); null when they cannot be compared. */
export function deltaPct(base: Experiment | undefined, cur: Experiment): number | null {
  if (!base?.best || !cur.best || base.best.metric !== cur.best.metric || base.best.value <= 0) return null;
  return ((cur.best.value - base.best.value) / base.best.value) * 100;
}

function record(label: string, out: Pick<SearchOutcome, "ranked" | "candidates" | "flags">) {
  const s = useStore.getState();
  s.patchStructure({ experiments: [...s.experiments, experimentFrom(s.experiments.length, label, out)] });
}

/** Capture "before any change" from the current results, once per lab session. */
function ensureBaseline() {
  const s = useStore.getState();
  if (s.experiments.length === 0 && s.searchRequest && s.results.length) {
    record("Baseline (before any change)", { ranked: s.results, candidates: s.candidates, flags: s.flags });
  }
}

/** Run the current search again after a change, publish the results and add a comparison row. */
async function rerunAndRecord(label: string, deps: Deps) {
  const s = useStore.getState();
  if (!s.searchRequest) return;
  const out = await deps.search(s.searchRequest);
  useStore.getState().setResults(out.ranked, out.flags, { candidates: out.candidates, costs: out.costs, splitHidden: out.splitHidden });
  record(label, out);
}

const message = (e: any) => String(e?.body?.message ?? e?.message ?? e);

export async function loadStructure(deps: Deps = real): Promise<void> {
  try {
    const st = await deps.api.getStructure();
    useStore.getState().patchStructure({ indexes: st.indexes, structureError: null });
  } catch (e) {
    useStore.getState().patchStructure({ structureError: message(e) });
  }
}

/** Apply structure changes to the sandbox, update the 3D web, re-run the search and compare with the baseline. */
export async function applyStructure(ops: StructureOp[], deps: Deps = real): Promise<boolean> {
  const set = useStore.getState().patchStructure;
  set({ structureBusy: true, structureError: null });
  try {
    ensureBaseline();
    const res = await deps.api.applyStructure(ops);
    useStore.getState().replaceGraph(res.graph);
    set({ indexes: res.indexes, lastExecuted: res.executed });
    await rerunAndRecord(ops.map(describeOp).join("; "), deps);
    return true;
  } catch (e) {
    set({ structureError: message(e) });
    return false;
  } finally {
    set({ structureBusy: false });
  }
}

export async function refillData(rows: number, deps: Deps = real): Promise<boolean> {
  const set = useStore.getState().patchStructure;
  set({ structureBusy: true, structureError: null });
  try {
    ensureBaseline();
    const res = await deps.api.refill(rows);
    useStore.getState().replaceGraph(res.graph);
    set({ indexes: res.indexes, lastExecuted: [] });
    await rerunAndRecord(`Data: ${rows.toLocaleString("en-US")} rows per table`, deps);
    return true;
  } catch (e) {
    set({ structureError: message(e) });
    return false;
  } finally {
    set({ structureBusy: false });
  }
}
