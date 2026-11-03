import { useState } from "react";
import { api } from "../api/client";
import type { Candidate, Ranked, RunResult } from "../types";
import { sqlFor } from "../search/sqlText";
import { useStore } from "../store/useStore";
import { WhyThisRank } from "./RankExplainer";

const RUN_LIMIT = 200;

interface Props { rank: number; r: Ranked; cand: Candidate; cost?: number; first?: Ranked; next?: Ranked; onHover(id: string | null): void }

export function ResultCard({ rank, r, cand, cost, first, next, onHover }: Props) {
  const [runs, setRuns] = useState<RunResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mode = useStore((s) => s.sqlMode);
  const sql = cand.queries.map((q) => sqlFor(q, mode)).join(";\n");
  const run = async () => {
    setErr(null);
    try {
      setRuns(await Promise.all(cand.queries.map((q) => api.run(q, RUN_LIMIT))));
    } catch (e: any) {
      setErr(String(e?.body?.message ?? e?.message ?? e));
    }
  };
  return (
    <article className="glass" style={{ padding: 10, margin: "8px 0", boxShadow: "none" }} onMouseEnter={() => onHover(r.id)} onMouseLeave={() => onHover(null)} aria-label={`Plan ${rank}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>#{rank}</b>
        <span style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(160,180,255,.15)" }} aria-label="score">
          <span style={{ display: "block", height: "100%", width: `${Math.max(8, (1 - r.score) * 100)}%`, borderRadius: 3, background: "var(--active)" }} />
        </span>
        <span className="mono" title="lower is better">score {r.score.toFixed(2)}</span>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="badge">{cand.joins} {cand.joins === 1 ? "join" : "joins"}</span>
        <span className="badge">{cand.query_count} {cand.query_count === 1 ? "query" : "queries"}</span>
        {r.metric === "time" && <span className="badge">{r.detail.cost.value.toFixed(2)} ms</span>}
        {cost !== undefined && <span className="badge">est. cost {cost.toFixed(1)}</span>}
        <span className="badge">{cand.shape}</span>
      </div>
      <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "6px 0", color: "var(--ui-text)" }}>{sql}</pre>
      {mode === "params" && cand.queries.some((q) => q.params.length) && <div className="mono" style={{ color: "var(--ui-muted)" }}>params: {JSON.stringify(cand.queries.map((q) => q.params))}</div>}
      <WhyThisRank r={r} position={rank} first={first} next={next} />
      {cand.shape === "Split" && <div className="warn">Split plan: returns separate result sets, not one joined table.</div>}
      <div className="row">
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(sql)}>Copy</button>
        <button className="btn" onClick={run}>Run</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {runs?.map((res, i) => (
        <div key={i}>
          <div className="row">
            <span className="badge">{res.row_count} rows</span>
            {res.truncated && <span className="badge" style={{ color: "var(--amber)" }}>first {res.row_count} rows shown, there are more</span>}
            {res.flags.map((f) => <span key={f.code} className="badge" style={{ color: "var(--amber)" }}>{f.code}</span>)}
          </div>
          {res.rows.length > 0 && (
            <div aria-label="Query result rows" style={{ overflow: "auto", maxHeight: 340, border: "1px solid var(--border)", borderRadius: 8 }}>
              <table className="grid sticky-head">
                <thead><tr>{res.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
                <tbody>{res.rows.map((row, a) => <tr key={a}>{row.map((v, b) => <td key={b}>{v === null ? <i style={{ color: "var(--ui-muted)" }}>null</i> : String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </article>
  );
}
