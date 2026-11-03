import { api as realApi, type Api } from "../api/client";
import { runSearch as realSearch, type SearchOutcome } from "../search/runSearch";
import type { Experiment, SearchRequest, StructureOp } from "../types";
import { useStore } from "./useStore";

interface Deps {
  api: Pick<Api, "applyStructure" | "refill" | "getStructure"> & Partial<Pick<Api, "getSuggestions">>;
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

/** Label of an experiment: short even when many operations were applied at once. */
export function labelFor(ops: StructureOp[]): string {
  return ops.length <= 2 ? ops.map(describeOp).join("; ") : `${describeOp(ops[0])} and ${ops.length - 1} more`;
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

/** Fetch the suggested links (relations the schema does not declare) for the current database. */
export async function loadSuggestions(deps: { api: Partial<Pick<Api, "getSuggestions">> } = real): Promise<void> {
  try {
    const r = await deps.api.getSuggestions?.();
    if (r) useStore.getState().patchStructure({ suggestions: r.suggestions, suggestionsSource: r.data_source });
  } catch {
    useStore.getState().patchStructure({ suggestions: [], suggestionsSource: null });
  }
}

/** Declare suggested relations as real (NOT VALID) foreign keys in the sandbox. */
export function addSuggestions(ids: string[], deps: Deps = real): Promise<boolean> {
  const pick = new Set(ids);
  const ops: StructureOp[] = useStore.getState().suggestions.filter((s) => pick.has(s.id)).map((s) => ({ kind: "add_fk", table: s.from_table, columns: s.from_columns, ref_table: s.to_table, ref_columns: s.to_columns }));
  return ops.length ? applyStructure(ops, deps) : Promise.resolve(false);
}

const message = (e: any) => String(e?.body?.message ?? e?.message ?? e);

export async function loadStructure(deps: Deps = real): Promise<void> {
  try {
    const st = await deps.api.getStructure();
    useStore.getState().patchStructure({ indexes: st.indexes, structureError: null });
    await loadSuggestions(deps);
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
    set({ indexes: res.indexes, lastExecuted: res.executed, changeLog: [...useStore.getState().changeLog, { label: labelFor(ops), sql: res.executed }] });
    await loadSuggestions(deps);
    await rerunAndRecord(labelFor(ops), deps);
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
    set({ indexes: res.indexes, lastExecuted: [], changeLog: [...useStore.getState().changeLog, { label: `Data: ${rows.toLocaleString("en-US")} rows per table`, sql: [] }] });
    await loadSuggestions(deps);
    await rerunAndRecord(`Data: ${rows.toLocaleString("en-US")} rows per table`, deps);
    return true;
  } catch (e) {
    set({ structureError: message(e) });
    return false;
  } finally {
    set({ structureBusy: false });
  }
}
