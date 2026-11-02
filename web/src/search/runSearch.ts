import type { Flag, Ranked, SearchRequest } from "../types";

export interface SearchOutcome { ranked: Ranked[]; flags: Flag[] }

/** Diagnose → plan → EXPLAIN → rank. Implemented in the orchestration task. */
export async function runSearch(_req: SearchRequest): Promise<SearchOutcome> {
  return { ranked: [], flags: [] };
}
