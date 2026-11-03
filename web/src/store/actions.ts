import { api as realApi, asSchemaError, type Api } from "../api/client";
import type { ImportData, LiveParams } from "../types";
import { useStore } from "./useStore";

interface Deps { api: Pick<Api, "getDefaultSchema" | "postSchema" | "connectLive" | "disconnectLive"> }
const real: Deps = { api: realApi };

function show(graph: Parameters<ReturnType<typeof useStore.getState>["setGraph"]>[0], warnings: string[], mode: "sandbox" | "live", data: ImportData | null = null) {
  const s = useStore.getState();
  s.setSourceMode(mode);
  s.setGraph(graph);
  useStore.setState({ schemaError: null, liveError: null, warnings, importData: data, shimmerAt: performance.now() });
}

/** Parse + load a DDL script. On error the previous graph stays and `schemaError` is set. */
export async function loadSchema(ddl: string, deps: Deps = real): Promise<void> {
  try {
    const r = await deps.api.postSchema(ddl, useStore.getState().useDumpData);
    show(r.graph, r.warnings, "sandbox", r.data ?? null);
  } catch (e: any) {
    useStore.setState({ schemaError: asSchemaError(e) ?? { message: String(e?.message ?? e), line: 0, col: 0 } });
  }
}

export async function resetSchema(deps: Deps = real): Promise<void> {
  try {
    const r = await deps.api.getDefaultSchema();
    show(r.graph, r.warnings, "sandbox", r.data ?? null);
  } catch (e: any) {
    useStore.setState({ schemaError: { message: String(e?.message ?? e), line: 0, col: 0 } });
  }
}

export async function connectLive(p: LiveParams, deps: Deps = real): Promise<void> {
  try {
    const r = await deps.api.connectLive(p);
    show(r.graph, [], "live");
  } catch (e: any) {
    useStore.setState({ liveError: String(e?.message ?? e) });
  }
}

export async function disconnectLive(deps: Deps = real): Promise<void> {
  try {
    await deps.api.disconnectLive();
  } finally {
    await resetSchema(deps);
  }
}
