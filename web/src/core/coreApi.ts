import type * as Wasm from "@wasm/cosmos_core.js";
import type { Candidate, ExplainCost, Flag, Ranked, SchemaGraph, SearchRequest } from "../types";

export interface CoreApi {
  /** `initial` = x,y,z per table (NaN = place randomly): keeps an edited graph's shape */
  layoutNew(graph: SchemaGraph, seed: number, initial?: Float32Array | number[]): Promise<void>;
  layoutStep(n: number): Promise<Float32Array>;
  layoutSettled(): Promise<boolean>;
  planCandidates(graph: SchemaGraph, req: SearchRequest): Promise<Candidate[]>;
  diagnose(graph: SchemaGraph, req: SearchRequest): Promise<Flag[]>;
  rank(cands: Candidate[], costs: ExplainCost[]): Promise<Ranked[]>;
  rankFlags(costs: ExplainCost[]): Promise<Flag[]>;
}

/** Wraps the wasm-bindgen module in the async CoreApi (runs inside the worker). */
export function createCoreApi(wasm: typeof Wasm): CoreApi {
  let layout: Wasm.WasmLayout | null = null;
  const j = JSON.stringify;
  return {
    async layoutNew(graph, seed, initial) {
      layout?.free?.();
      layout = initial && initial.length ? wasm.WasmLayout.with_positions(j(graph), seed, initial) : new wasm.WasmLayout(j(graph), seed);
    },
    async layoutStep(n) {
      if (!layout) throw new Error("layout not initialised");
      layout.step(n);
      return new Float32Array(layout.positions());
    },
    async layoutSettled() {
      return layout ? layout.settled() : true;
    },
    async planCandidates(graph, req) {
      return JSON.parse(wasm.plan_candidates(j(graph), j(req)));
    },
    async diagnose(graph, req) {
      return JSON.parse(wasm.diagnose(j(graph), j(req)));
    },
    async rank(cands, costs) {
      return JSON.parse(wasm.rank(j(cands), j(costs)));
    },
    async rankFlags(costs) {
      return JSON.parse(wasm.rank_flags(j(costs)));
    },
  };
}
