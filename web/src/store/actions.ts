import { api as realApi, asSchemaError, type Api } from "../api/client";
import type { ImportData, LiveParams } from "../types";
import { clearDatabase, loadDatabase, saveDatabase, sizeOf } from "./dbStore";
import { loadSuggestions } from "./structureActions";
import { useStore } from "./useStore";

interface Deps { api: Pick<Api, "getDefaultSchema" | "postSchema" | "connectLive" | "disconnectLive"> & Partial<Pick<Api, "getSuggestions" | "startSchemaJob" | "getJob">> }
interface JobOpts { pollMs?: number; /** false = do not save this import (used when reloading the saved one) */ remember?: boolean }
const real: Deps = { api: realApi };

function show(graph: Parameters<ReturnType<typeof useStore.getState>["setGraph"]>[0], warnings: string[], mode: "sandbox" | "live", data: ImportData | null = null) {
  const s = useStore.getState();
  s.setSourceMode(mode);
  s.setGraph(graph);
  useStore.setState({ schemaError: null, liveError: null, warnings, importData: data, shimmerAt: performance.now() });
}

let running = false;

/** Import in the background: the parsed graph appears at once, a progress bar follows, the loaded graph replaces it. */
async function runJob(ddl: string | null, deps: Deps, opts: JobOpts): Promise<void> {
  const { startSchemaJob, getJob } = deps.api;
  if (!startSchemaJob || !getJob) throw new Error("jobs unavailable");
  if (running) {
    useStore.setState({ schemaError: { message: "an import is already running, wait for it to finish", line: 0, col: 0 } });
    return;
  }
  running = true;
  try {
    const first = await startSchemaJob(ddl, useStore.getState().useDumpData);
    show(first.graph, first.warnings, "sandbox", null);
    useStore.setState({ importProgress: { stage: "Starting", percent: 0, message: "" } });
    for (;;) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 300));
      const j = await getJob(first.job_id);
      if (j.status === "running") {
        useStore.setState({ importProgress: { stage: j.stage, percent: j.percent, message: j.message } });
        continue;
      }
      if (j.status === "error" || !j.result) throw new Error(j.error ?? "import failed");
      const st = useStore.getState();
      st.replaceGraph(j.result.graph);
      useStore.setState({ warnings: j.result.warnings, importData: j.result.data ?? null });
      void loadSuggestions(deps);
      return;
    }
  } finally {
    running = false;
    useStore.setState({ importProgress: null });
  }
}

/** Parse + load a DDL script. On error the previous graph stays and `schemaError` is set. */
export async function loadSchema(ddl: string, deps: Deps = real, opts: JobOpts = {}): Promise<void> {
  try {
    if (deps.api.startSchemaJob && deps.api.getJob) await runJob(ddl, deps, opts);
    else {
      const r = await deps.api.postSchema(ddl, useStore.getState().useDumpData);
      show(r.graph, r.warnings, "sandbox", r.data ?? null);
      void loadSuggestions(deps);
    }
  } catch (e: any) {
    useStore.setState({ schemaError: asSchemaError(e) ?? { message: String(e?.message ?? e), line: 0, col: 0 } });
  }
  const st = useStore.getState();
  if (opts.remember !== false && st.rememberDb && st.schemaError === null && st.graph) {
    if (await saveDatabase(ddl, st.useDumpData)) useStore.getState().setSavedDb({ bytes: sizeOf(ddl), savedAt: Date.now() });
  }
}

/** On start: reload the database saved in this browser, or the default one when nothing is saved (or the saved one no longer loads). */
export async function restoreDatabase(deps: Deps = real, opts: JobOpts = {}): Promise<void> {
  const saved = await loadDatabase();
  if (!saved) return resetSchema(deps, opts);
  useStore.getState().setSavedDb({ bytes: sizeOf(saved.ddl), savedAt: saved.savedAt });
  useStore.getState().setUseDumpData(saved.useDump);
  await loadSchema(saved.ddl, deps, { ...opts, remember: false });
  if (useStore.getState().schemaError !== null) {
    const why = useStore.getState().schemaError!.message;
    await resetSchema(deps, opts);
    useStore.setState({ warnings: [`The database saved in this browser could not be loaded (${why}). The default one is shown. The saved copy is kept until you forget it.`] });
  }
}

/** Throw away the saved copy (the database on screen stays). */
export async function forgetDatabase(): Promise<void> {
  await clearDatabase();
  useStore.getState().setSavedDb(null);
}

export async function resetSchema(deps: Deps = real, opts: JobOpts = {}): Promise<void> {
  try {
    if (deps.api.startSchemaJob && deps.api.getJob) return await runJob(null, deps, opts);
    const r = await deps.api.getDefaultSchema();
    show(r.graph, r.warnings, "sandbox", r.data ?? null);
    void loadSuggestions(deps);
  } catch (e: any) {
    useStore.setState({ schemaError: { message: String(e?.message ?? e), line: 0, col: 0 } });
  }
}

export async function connectLive(p: LiveParams, deps: Deps = real): Promise<void> {
  try {
    const r = await deps.api.connectLive(p);
    show(r.graph, [], "live");
    void loadSuggestions(deps);
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
