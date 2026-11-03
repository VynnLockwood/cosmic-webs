import { describeRequest, droppedFrom } from "../search/describeRequest";
import { sqlFor } from "../search/sqlText";
import { useStore } from "../store/useStore";
import type { Candidate, Flag, SearchRequest } from "../types";

interface Props { req: SearchRequest; flags: Flag[]; top: Candidate | null }

/** Before / after: the request as asked (dropped parts struck through) next to the SQL that actually ran. */
export function AskedVsRan({ req, flags, top }: Props) {
  const mode = useStore((s) => s.sqlMode);
  const d = droppedFrom(flags);
  if (d.tables.size === 0 && d.columns.size === 0) return null;
  const lines = describeRequest(req, d);
  const names = [...d.tables, ...d.columns].map((n) => n.replace(/^public\./, ""));
  return (
    <section aria-label="Your request compared with what ran" className="glass" style={{ padding: 10, margin: "8px 0", boxShadow: "none" }}>
      <h3 style={{ margin: "0 0 4px" }}>Part of your request was dropped</h3>
      <div style={{ color: "var(--ui-muted)", marginBottom: 6 }}>Struck-through parts could not be answered ({names.join(", ")}), so the plans below leave them out.</div>
      {d.tables.size > 0 && (
        <div className="row" style={{ marginBottom: 6 }}>
          <span style={{ flex: 1 }}>No foreign key links these tables, so running BEFORE pairs every row with every row. If two columns hold the same values, tell the search how they match.</span>
          <button className="btn" onClick={() => { const s = useStore.getState(); if (s.searchJoins.length === 0) s.setSearchJoins([{ from: "", to: "" }]); s.setDrawer("search"); }}>Add a join</button>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="mono" style={{ color: "var(--ui-muted)", fontSize: 11 }}>BEFORE · what you asked (runs as is; the dropped tables are cross-joined)</span>
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(lines.map((l) => l.map((x) => x.text).join("")).join("\n"))}>Copy</button>
      </div>
      <pre className="mono ask-before" aria-label="Request as asked" style={{ whiteSpace: "pre-wrap", margin: "2px 0 8px" }}>
        {lines.map((l, i) => (
          <div key={i}>{l.map((s, j) => (s.dropped ? <del key={j} className="dropped">{s.text}</del> : s.note ? <span key={j} style={{ color: "var(--ui-muted)" }}>{s.text}</span> : <span key={j}>{s.text}</span>))}</div>
        ))}
      </pre>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="mono" style={{ color: "var(--ui-muted)", fontSize: 11 }}>AFTER · what ran (best plan)</span>
        {top && <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(top.queries.map((q) => sqlFor(q, mode)).join(";\n"))}>Copy</button>}
      </div>
      {top ? (
        <pre className="mono ask-after" aria-label="Query that ran" style={{ whiteSpace: "pre-wrap", margin: "2px 0 0" }}>{top.queries.map((q) => sqlFor(q, mode)).join(";\n")}</pre>
      ) : (
        <div className="warn">Nothing runnable was left after dropping those parts.</div>
      )}
    </section>
  );
}
