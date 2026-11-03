import { useState } from "react";
import { connectLive, disconnectLive } from "../store/actions";
import { useStore } from "../store/useStore";

export function SourcePanel() {
  const mode = useStore((s) => s.sourceMode);
  const err = useStore((s) => s.liveError);
  const [f, setF] = useState({ host: "localhost", port: "5432", dbname: "", user: "", password: "", schema: "public", analyze: false });
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
        <button className="btn" onClick={() => connectLive({ host: f.host, port: Number(f.port) || 5432, dbname: f.dbname, user: f.user, password: f.password, schema: f.schema, allow_analyze: f.analyze })}>Connect</button>
        <button className="btn ghost" onClick={() => disconnectLive()} disabled={mode !== "live"}>Use sandbox</button>
      </div>
      <p style={{ color: "var(--ui-muted)", fontSize: 12 }}>Sessions are read-only with a 5 s timeout. The password stays in server memory only.</p>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}
