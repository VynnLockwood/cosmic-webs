import { useState } from "react";
import { connectLive, disconnectLive } from "../store/actions";
import { useStore } from "../store/useStore";

const LIVE_KEY = "cosmos.live";
/** Connection details saved in this browser. The password is never saved. */
function loadLive() {
  const d = { host: "localhost", port: "5432", dbname: "", user: "", schema: "public" };
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_KEY) ?? "null");
    for (const k of Object.keys(d) as (keyof typeof d)[]) if (typeof v?.[k] === "string") d[k] = v[k];
  } catch { /* use defaults */ }
  return d;
}

export function SourcePanel() {
  const mode = useStore((s) => s.sourceMode);
  const err = useStore((s) => s.liveError);
  const [f, setF] = useState(() => ({ ...loadLive(), password: "", analyze: false }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const field = (k: "host" | "port" | "dbname" | "user" | "password" | "schema", label: string, type = "text") => (
    <div className="row"><label htmlFor={`live-${k}`}>{label}</label><input id={`live-${k}`} type={type} value={f[k]} onChange={set(k)} autoComplete="off" /></div>
  );
  return (
    <>
      <h2>Data source</h2>
      <p style={{ color: "var(--ui-muted)" }}>Current: <b>{mode === "live" ? "Live Postgres (read-only)" : "Sandbox (mock data)"}</b></p>
      <h3>Live Postgres</h3>
      {field("host", "Host")}{field("port", "Port")}{field("dbname", "Database")}{field("user", "User")}{field("password", "Password", "password")}{field("schema", "Schema")}
      <div className="row"><label htmlFor="live-analyze">Analyze</label><input id="live-analyze" type="checkbox" checked={f.analyze} onChange={set("analyze")} /><span style={{ color: "var(--ui-muted)", fontSize: 12 }}>allow EXPLAIN ANALYZE (runs the query)</span></div>
      <div className="row">
        <button className="btn" onClick={() => {
          try { localStorage.setItem(LIVE_KEY, JSON.stringify({ host: f.host, port: f.port, dbname: f.dbname, user: f.user, schema: f.schema })); } catch { /* private mode */ }
          return connectLive({ host: f.host, port: Number(f.port) || 5432, dbname: f.dbname, user: f.user, password: f.password, schema: f.schema, allow_analyze: f.analyze });
        }}>Connect</button>
        <button className="btn ghost" onClick={() => disconnectLive()} disabled={mode !== "live"}>Use sandbox</button>
      </div>
      <p style={{ color: "var(--ui-muted)", fontSize: 12 }}>Sessions are read-only with a 5 s timeout. The password stays in server memory only; host, database, user and schema are remembered in this browser (never the password).</p>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}
