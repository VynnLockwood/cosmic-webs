import { api as realApi, type Api } from "../api/client";
import { getCore } from "../core/coreClient";
import type { CoreApi } from "../core/coreApi";
import { useStore } from "../store/useStore";
import type { Candidate, ExplainCost, ExplainResult, Flag, FlagCode, Ranked, SchemaGraph, SearchRequest } from "../types";

export interface SearchOutcome {
  ranked: Ranked[];
  flags: Flag[];
  candidates: Candidate[];
  costs: Record<string, { total_cost: number; plan_rows: number; exec_ms?: number | null }>;
  /** split plans left out because they return separate result sets */
  splitHidden: number;
}
export interface SearchOptions { measure: boolean; includeSplit: boolean }
interface Deps { core: Pick<CoreApi, "diagnose" | "planCandidates" | "rank" | "rankFlags">; api: Pick<Api, "explain"> }

const TOP_N = 5;

/** Measuring runs every plan for real, which is only allowed (and meaningful) on the sandbox. */
export function defaultOptions(): SearchOptions {
  const s = useStore.getState();
  return { measure: s.measureTime && s.sourceMode === "sandbox", includeSplit: s.includeSplit };
}
const key = (f: Flag) => `${f.code}|${f.table ?? ""}|${f.column ?? ""}|${f.message}`;

function toCost(r: ExplainResult): ExplainCost {
  const code = r.error?.code;
  // The core only knows flag codes: a database SQL error (almost always a type problem) counts as TYPE_MISMATCH.
  const error: FlagCode | null = !code ? null : code === "PERMISSION" || code === "TIMEOUT" ? code : "TYPE_MISMATCH";
  return { id: r.id, total_cost: r.total_cost, plan_rows: r.plan_rows, exec_ms: r.exec_ms ?? null, error };
}

/** diagnose → plan → EXPLAIN → rank. Rejects if the API call itself fails. */
export async function runSearch(
  req: SearchRequest,
  graph: SchemaGraph | null = useStore.getState().graph,
  deps?: Deps,
  opts: SearchOptions = defaultOptions(),
): Promise<SearchOutcome> {
  const { core, api } = deps ?? { core: getCore(), api: realApi };
  const g = graph ?? { tables: [], fks: [] };
  const flags: Flag[] = [...(await core.diagnose(g, req))];
  const all = await core.planCandidates(g, req);
  const candidates = opts.includeSplit ? all : all.filter((c) => c.shape !== "Split");
  const splitHidden = all.length - candidates.length;
  let ranked: Ranked[] = [];
  const costs: SearchOutcome["costs"] = {};
  if (candidates.length) {
    const { results } = await api.explain(candidates, opts.measure);
    const explain = results.map(toCost);
    results.forEach((r) => (costs[r.id] = { total_cost: r.total_cost, plan_rows: r.plan_rows, exec_ms: r.exec_ms }));
    ranked = (await core.rank(candidates, explain)).slice(0, TOP_N);
    flags.push(...(await core.rankFlags(explain)));
    const seen = new Set<string>();
    for (const r of results) {
      if (r.error && r.error.code !== "PERMISSION" && r.error.code !== "TIMEOUT" && !seen.has(r.error.message)) {
        seen.add(r.error.message);
        flags.push({ code: "TYPE_MISMATCH", table: null, column: null, message: `A candidate failed in the database: ${r.error.message}` });
      }
    }
  }
  const dedup = new Map(flags.map((f) => [key(f), f]));
  return { ranked, flags: [...dedup.values()], candidates, costs, splitHidden };
}
