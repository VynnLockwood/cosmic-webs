import { useState } from "react";
import { applyAiAnswer, askAi, type AskInfo } from "../../ai/askAi";
import { aiReady } from "../../ai/aiSettings";
import type { AiAnswer } from "../../ai/parseAnswer";
import { executeSearch } from "../../search/executeSearch";
import { useStore } from "../../store/useStore";

/** Say in plain words what you want to see; the model drafts the query structure (names only, never rows). */
export function ExpectedResult({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const ai = useStore((s) => s.ai);
  const graph = useStore((s) => s.graph);
  const aiSql = useStore((s) => s.aiSql);
  const setAiSql = useStore((s) => s.setAiSql);
  const setDrawer = useStore((s) => s.setDrawer);
  const [goal, setGoal] = useState("");
  const [runAfter, setRunAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [info, setInfo] = useState<AskInfo | null>(null);
  const ready = aiReady(ai);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const a = await askAi(goal, graph ?? { tables: [], fks: [] }, ai, fetchImpl, setInfo);
      if (a.error) {
        setError(a.error);
        return;
      }
      applyAiAnswer(a);
      setAnswer(a);
      if (runAfter) {
        const errs = await executeSearch();
        if (errs.length) setError(errs.join(" "));
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Expected result" className="glass" style={{ padding: 10, margin: "0 0 10px", boxShadow: "none" }}>
      <h3 style={{ margin: "0 0 4px" }}>Expected result <span className="badge">AI</span></h3>
      <textarea
        aria-label="Describe the result you expect"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="e.g. every customer's name with the total they paid, biggest first, top 20; include customers who never ordered"
        style={{ minHeight: 70 }}
      />
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={runAfter} onChange={(e) => setRunAfter(e.target.checked)} /> <span>Run the search right after</span>
      </label>
      <div className="row">
        <button className="btn" onClick={ask} disabled={busy || goal.trim() === "" || !ready}>{busy ? "Thinking…" : "Ask AI"}</button>
        {!ready && <button className="btn ghost" onClick={() => setDrawer("settings")}>Add API key in Settings</button>}
      </div>
      <div style={{ color: "var(--ui-muted)", fontSize: 12 }}>
        Sends table and column names and types to OpenRouter{ready ? ` (${ai.model})` : ""}. No rows, no values from your database. The database is not touched.
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {answer && (
        <div role="status" aria-label="AI answer" style={{ marginTop: 6 }}>
          {answer.explanation && <p style={{ margin: "0 0 4px" }}>{answer.explanation}</p>}
          <div style={{ color: "var(--ui-muted)", fontSize: 12 }}>
            {answer.request ? "Filled the builder below. " : ""}{answer.joins.length ? `${answer.joins.length} join${answer.joins.length === 1 ? "" : "s"} added. ` : ""}{answer.sqls.length ? `${answer.sqls.length} full SQL quer${answer.sqls.length === 1 ? "y" : "ies"} will be ranked with the rest. ` : ""}
            {info && info.tables < info.total ? `Only ${info.tables} of ${info.total} tables were sent (the ones that look related). ` : ""}Check it, change anything, then Search.
          </div>
          {answer.warnings.map((w, i) => <div key={i} className="warn">{w}</div>)}
        </div>
      )}
      {aiSql.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>AI SQL ({aiSql.length})</b>
            <button className="btn ghost" onClick={() => setAiSql([])}>Clear AI SQL</button>
          </div>
          {aiSql.map((q, i) => (
            <details key={i}>
              <summary>{q.title}</summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{q.sql}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
