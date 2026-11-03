import { useRef, useState } from "react";
import { loadSchema, resetSchema } from "../store/actions";
import { useStore } from "../store/useStore";

export function SchemaPanel() {
  const [ddl, setDdl] = useState("");
  const err = useStore((s) => s.schemaError);
  const warnings = useStore((s) => s.warnings);
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
      <div className="row">
        <button className="btn" onClick={() => loadSchema(ddl)} disabled={!ddl.trim()}>Build web</button>
        <button className="btn ghost" onClick={() => resetSchema()}>Reset to default</button>
      </div>
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
