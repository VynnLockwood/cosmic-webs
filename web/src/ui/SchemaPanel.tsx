import { useRef, useState } from "react";
import { loadSchema, resetSchema } from "../store/actions";
import { useStore } from "../store/useStore";
import { ImportProgress } from "./ImportProgress";

export function SchemaPanel() {
  const [ddl, setDdl] = useState("");
  const err = useStore((s) => s.schemaError);
  const warnings = useStore((s) => s.warnings);
  const data = useStore((s) => s.importData);
  const useDump = useStore((s) => s.useDumpData);
  const setUseDump = useStore((s) => s.setUseDumpData);
  const suggestions = useStore((s) => s.suggestions);
  const setDrawer = useStore((s) => s.setDrawer);
  const busy = useStore((s) => s.importProgress !== null);
  const file = useRef<HTMLInputElement>(null);
  const onFile = async (f?: File | null) => {
    if (!f) return;
    const text = await f.text();
    setDdl(text);
    await loadSchema(text);
  };
  return (
    <>
      <h2>Schema</h2>
      <p style={{ color: "var(--ui-muted)", margin: "0 0 8px" }}>Upload a Postgres <span className="mono">.sql</span> file or paste DDL. Each table becomes a dot, each foreign key a link.</p>
      <input ref={file} type="file" accept=".sql,.txt,text/plain" aria-label="Upload schema file" onChange={(e) => onFile(e.target.files?.[0])} />
      <h3>Or paste DDL</h3>
      <textarea aria-label="DDL" value={ddl} onChange={(e) => setDdl(e.target.value)} placeholder="CREATE TABLE users (...);" spellCheck={false} />
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={useDump} onChange={(e) => setUseDump(e.target.checked)} />
        <span>Use the rows in the file when it has any <span style={{ color: "var(--ui-muted)" }}>(otherwise mock rows are generated)</span></span>
      </label>
      <div className="row">
        <button className="btn" onClick={() => loadSchema(ddl)} disabled={!ddl.trim() || busy}>Build web</button>
        <button className="btn ghost" onClick={() => resetSchema()}>Reset to default</button>
      </div>
      <ImportProgress />
      {data && (
        <p role="status" style={{ margin: "8px 0", color: "var(--ui-muted)" }}>
          {data.source === "dump"
            ? `Loaded ${data.rows_loaded.toLocaleString("en-US")} rows from your file into ${data.tables_with_data} tables. ${data.tables_empty} tables have no rows in the file and stay empty.`
            : `No rows in the file (or ignored): generated ${data.rows_loaded.toLocaleString("en-US")} mock rows over ${data.tables_with_data} tables.`}
        </p>
      )}
      {suggestions.length > 0 && (
        <p style={{ margin: "8px 0" }}>
          {suggestions.length} possible link{suggestions.length === 1 ? "" : "s"} the file does not declare
          {suggestions.some((s) => s.verified) ? ` (${suggestions.filter((s) => s.verified).length} confirmed by its rows)` : ""}.{" "}
          <button className="btn ghost" onClick={() => setDrawer("structure")}>Review in Structure lab</button>
        </p>
      )}
      {err && (
        <div className="err" role="alert">
          {err.line > 0 ? `Line ${err.line}, col ${err.col}: ` : ""}
          {err.message}
        </div>
      )}
      {warnings.map((w, i) => <div key={i} className="warn">{w}</div>)}
    </>
  );
}
