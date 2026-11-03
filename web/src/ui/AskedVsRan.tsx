import { describeRequest, droppedFrom } from "../search/describeRequest";
import type { Candidate, Flag, SearchRequest } from "../types";

interface Props { req: SearchRequest; flags: Flag[]; top: Candidate | null }

/** Before / after: the request as asked (dropped parts struck through) next to the SQL that actually ran. */
export function AskedVsRan({ req, flags, top }: Props) {
  const d = droppedFrom(flags);
  if (d.tables.size === 0 && d.columns.size === 0) return null;
  const lines = describeRequest(req, d);
  const names = [...d.tables, ...d.columns].map((n) => n.replace(/^public\./, ""));
  return (
    <section aria-label="Your request compared with what ran" className="glass" style={{ padding: 10, margin: "8px 0", boxShadow: "none" }}>
      <h3 style={{ margin: "0 0 4px" }}>Part of your request was dropped</h3>
      <div style={{ color: "var(--ui-muted)", marginBottom: 6 }}>Struck-through parts could not be answered ({names.join(", ")}), so the plans below leave them out.</div>
      <div className="mono" style={{ color: "var(--ui-muted)", fontSize: 11 }}>BEFORE · what you asked</div>
      <pre className="mono ask-before" aria-label="Request as asked" style={{ whiteSpace: "pre-wrap", margin: "2px 0 8px" }}>
        {lines.map((l, i) => (
          <div key={i}>{l.map((s, j) => (s.dropped ? <del key={j} className="dropped">{s.text}</del> : <span key={j}>{s.text}</span>))}</div>
        ))}
      </pre>
      <div className="mono" style={{ color: "var(--ui-muted)", fontSize: 11 }}>AFTER · what ran (best plan)</div>
      {top ? (
        <pre className="mono ask-after" aria-label="Query that ran" style={{ whiteSpace: "pre-wrap", margin: "2px 0 0" }}>{top.queries.map((q) => q.sql).join(";\n")}</pre>
      ) : (
        <div className="warn">Nothing runnable was left after dropping those parts.</div>
      )}
    </section>
  );
}
