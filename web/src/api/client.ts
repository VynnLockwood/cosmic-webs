import type { StructureOp, StructureResult, StructureState, ExplainResult, LiveParams, ParseResult, RowsPage, RunResult, SchemaError, SchemaGraph, Candidate, SqlQuery } from "../types";

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message ?? body?.detail ?? `HTTP ${status}`);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  getDefaultSchema: () => call<ParseResult>("GET", "/schema/default"),
  postSchema: (ddl: string, useDumpData = true) => call<ParseResult>("POST", "/schema", { ddl, use_dump_data: useDumpData }),
  connectLive: (p: LiveParams) => call<{ graph: SchemaGraph }>("POST", "/source/live", p),
  disconnectLive: () => call<{ mode: string }>("DELETE", "/source/live"),
  getRows: (table: string, limit = 50, offset = 0) => call<RowsPage>("GET", `/tables/${encodeURIComponent(table)}/rows?limit=${limit}&offset=${offset}`),
  explain: (candidates: Candidate[], analyze = false, repeat = 3) =>
    call<{ results: ExplainResult[] }>("POST", "/explain", { candidates: candidates.map((c) => ({ id: c.id, queries: c.queries })), analyze, repeat }),
  getStructure: () => call<StructureState>("GET", "/structure"),
  applyStructure: (ops: StructureOp[]) => call<StructureResult>("POST", "/structure/apply", { ops }),
  refill: (rows_per_table: number) => call<StructureState>("POST", "/sandbox/refill", { rows_per_table }),
  run: (query: SqlQuery, limit = 100) => call<RunResult>("POST", "/run", { query, limit }),
};
export type Api = typeof api;
export const asSchemaError = (e: unknown): SchemaError | null =>
  e instanceof ApiError && e.status === 422 ? { message: e.body.message, line: e.body.line, col: e.body.col } : null;
