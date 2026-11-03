import { useState } from "react";
import { api as realApi, ApiError } from "../../api/client";
import { changeScript, experimentsCsv } from "../../store/exportScripts";
import { useStore } from "../../store/useStore";
import { downloadText } from "../download";

type ExportApi = { exportStructure(kind: "schema" | "full"): Promise<string> };
const FILES = { schema: "cosmic-webs-structure.sql", full: "cosmic-webs-structure-and-data.sql" } as const;

/** Take the work out of the lab: the structure, the data, the changes made, the before/after table. */
export function ExportSection({ api = realApi }: { api?: ExportApi }) {
  const log = useStore((s) => s.changeLog);
  const experiments = useStore((s) => s.experiments);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fromServer = async (kind: "schema" | "full") => {
    setBusy(kind);
    setError(null);
    try {
      downloadText(FILES[kind], await api.exportStructure(kind));
    } catch (e: any) {
      setError(String(e instanceof ApiError ? e.message : e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label="Export">
      <h3>Export</h3>
      <p style={{ margin: "0 0 6px", color: "var(--ui-muted)" }}>Take your work out of the sandbox as files.</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn" disabled={busy !== null} onClick={() => fromServer("schema")} title="CREATE TABLE, keys, indexes of the sandbox now">Current structure (.sql)</button>
        <button className="btn ghost" disabled={busy !== null} onClick={() => fromServer("full")} title="Same, plus every row as COPY blocks (can be large)">Structure + data (.sql)</button>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn ghost" disabled={log.length === 0} onClick={() => downloadText("cosmic-webs-changes.sql", changeScript(log))} title="Only the statements you ran here, to apply to your real database">Changes script (.sql)</button>
        <button className="btn ghost" disabled={experiments.length === 0} onClick={() => downloadText("cosmic-webs-experiments.csv", experimentsCsv(experiments), "text/csv;charset=utf-8")} title="The Before / after table">Before / after table (.csv)</button>
      </div>
      {busy && <div role="status" style={{ color: "var(--active)" }}>Preparing the file…</div>}
      {error && <div className="err" role="alert">{error}</div>}
    </section>
  );
}
