import { HOW_IT_WORKS, rankLines, rankVerdict } from "../search/explainRank";
import type { Ranked } from "../types";

/** "How we rank": the formula, the weights and what the numbers mean. */
export function HowRankingWorks({ results }: { results: Ranked[] }) {
  const n = results[0]?.compared;
  const by = results[0]?.metric === "time" ? "measured run time" : "the planner's estimated cost";
  return (
    <details style={{ margin: "6px 0 10px" }}>
      <summary style={{ cursor: "pointer", color: "var(--active)" }}>How ranking works{n ? ` — ${n} plans compared by ${by}` : ""}</summary>
      <p style={{ margin: "6px 0" }}>{HOW_IT_WORKS.intro}</p>
      <table className="grid" aria-label="Ranking weights">
        <tbody>{HOW_IT_WORKS.weights.map(([k, w]) => <tr key={k}><td>{k}</td><td style={{ textAlign: "right" }}>{w}</td></tr>)}</tbody>
      </table>
      <ul style={{ margin: "6px 0", paddingLeft: 18, color: "var(--ui-muted)" }}>{HOW_IT_WORKS.notes.map((x) => <li key={x}>{x}</li>)}</ul>
    </details>
  );
}

/** "Why #n?": one sentence plus the score sheet of a single plan. */
export function WhyThisRank({ r, position, first, next }: { r: Ranked; position: number; first?: Ranked; next?: Ranked }) {
  const lines = rankLines(r);
  return (
    <details open={position === 1} style={{ margin: "6px 0" }}>
      <summary style={{ cursor: "pointer", color: "var(--active)" }}>Why #{position}? score {r.score.toFixed(2)}</summary>
      <p style={{ margin: "6px 0" }}>{rankVerdict(r, position, first, next)}</p>
      <div style={{ overflow: "auto" }}>
        <table className="grid" aria-label={`Score sheet for plan ${position}`}>
          <thead><tr><th>Metric</th><th>This plan</th><th>Best</th><th>Worst</th><th>Weight</th><th>Points</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.label}</td><td><b>{l.value}</b></td><td>{l.best}</td><td>{l.worst}</td><td>{Math.round(l.weight * 100)}%</td>
                <td>
                  <span style={{ display: "inline-block", height: 6, width: Math.max(2, l.points * 120), background: "var(--amber)", borderRadius: 3, marginRight: 6, verticalAlign: "middle" }} />
                  {l.points.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr><td colSpan={5}><b>Score (lower is better)</b></td><td><b>{r.score.toFixed(2)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <p style={{ margin: "4px 0", fontSize: 12, color: "var(--ui-muted)" }}>
        Points = weight × where the plan sits between the best (0) and the worst (1) of the {r.compared} compared plans.
      </p>
    </details>
  );
}
