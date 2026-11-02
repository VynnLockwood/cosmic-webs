import { useStore } from "../store/useStore";
import { FlagList } from "./FlagList";
import { ResultCard } from "./ResultCard";

export function ResultsPanel() {
  const results = useStore((s) => s.results);
  const candidates = useStore((s) => s.candidates);
  const costs = useStore((s) => s.costs);
  const flags = useStore((s) => s.flags);
  const req = useStore((s) => s.searchRequest);
  const setHover = useStore((s) => s.setHoverPlan);
  return (
    <>
      <h2>Results</h2>
      {!req && <p style={{ color: "var(--ui-muted)" }}>Run a search to see the five best query plans.</p>}
      {req && results.length === 0 && <p style={{ color: "var(--ui-muted)" }}>No runnable plan was found.{flags.length ? " See the flags below." : ""}</p>}
      {results.map((r, i) => {
        const cand = candidates.find((c) => c.id === r.id);
        return cand ? <ResultCard key={r.id} rank={i + 1} r={r} cand={cand} cost={costs[r.id]?.total_cost} onHover={setHover} /> : null;
      })}
      <FlagList flags={flags} />
    </>
  );
}
