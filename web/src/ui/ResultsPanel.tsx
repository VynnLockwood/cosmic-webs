import { useStore } from "../store/useStore";
import { AskedVsRan } from "./AskedVsRan";
import { FlagList } from "./FlagList";
import { HowRankingWorks } from "./RankExplainer";
import { ResultCard } from "./ResultCard";

export function ResultsPanel() {
  const results = useStore((s) => s.results);
  const candidates = useStore((s) => s.candidates);
  const costs = useStore((s) => s.costs);
  const flags = useStore((s) => s.flags);
  const req = useStore((s) => s.searchRequest);
  const setHover = useStore((s) => s.setHoverPlan);
  const splitHidden = useStore((s) => s.splitHidden);
  const mode = useStore((s) => s.sqlMode);
  const setMode = useStore((s) => s.setSqlMode);
  return (
    <>
      <h2>Results</h2>
      <div className="row seg" role="group" aria-label="SQL style">
        <span style={{ flex: "0 0 auto", color: "var(--ui-muted)" }}>SQL</span>
        <button className={mode === "hardcoded" ? "btn" : "btn ghost"} aria-pressed={mode === "hardcoded"} onClick={() => setMode("hardcoded")} title="Values written into the SQL: paste into pgAdmin and it runs">Hardcoded values</button>
        <button className={mode === "params" ? "btn" : "btn ghost"} aria-pressed={mode === "params"} onClick={() => setMode("params")} title="$1, $2 … bind parameters, values listed apart: for application code">Params ($1)</button>
      </div>
      {!req && <p style={{ color: "var(--ui-muted)" }}>Run a search to see the five best query plans.</p>}
      {req && results.length === 0 && <p style={{ color: "var(--ui-muted)" }}>No runnable plan was found.{flags.length ? " See the flags below." : ""}</p>}
      {req && <AskedVsRan req={req} flags={flags} top={candidates.find((c) => c.id === results[0]?.id) ?? null} />}
      {results.length > 0 && <HowRankingWorks results={results} />}
      {splitHidden > 0 && <div className="warn">{splitHidden} split plan(s) hidden — they return separate result sets. Enable “Include split plans” in Search to rank them too.</div>}
      {results.map((r, i) => {
        const cand = candidates.find((c) => c.id === r.id);
        return cand ? <ResultCard key={r.id} rank={i + 1} r={r} cand={cand} cost={costs[r.id]?.total_cost} first={results[0]} next={results[i + 1]} onHover={setHover} /> : null;
      })}
      <FlagList flags={flags} />
    </>
  );
}
