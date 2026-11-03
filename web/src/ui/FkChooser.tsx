import { ambiguousPairs } from "../search/highlight";
import { runSearch } from "../search/runSearch";
import { useStore } from "../store/useStore";
import type { Flag } from "../types";

/** Lets the user pick which of several foreign keys between two tables a join should use. */
export function FkChooser({ flag }: { flag: Flag }) {
  const graph = useStore((s) => s.graph);
  const choices = useStore((s) => s.fkChoices);
  if (!graph) return null;
  const pairs = ambiguousPairs(graph, flag, choices);
  const choose = async (key: string, id: string) => {
    const s = useStore.getState();
    const next = { ...s.fkChoices, [key]: id };
    s.setFkChoices(next);
    if (!s.searchRequest) return;
    const req = { ...s.searchRequest, fk_choices: next };
    s.setSearch(req);
    const out = await runSearch(req);
    useStore.getState().setResults(out.ranked, out.flags, { candidates: out.candidates, costs: out.costs });
  };
  return (
    <div style={{ margin: "4px 0 8px 18px" }}>
      {pairs.map((p) => (
        <fieldset key={p.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px" }}>
          <legend className="mono">{p.a.replace(/^public\./, "")} ↔ {p.b.replace(/^public\./, "")}</legend>
          {p.fks.map((f) => (
            <label key={f.id} className="mono" style={{ display: "block", cursor: "pointer" }}>
              <input type="radio" name={p.key} checked={p.chosen === f.id} onChange={() => choose(p.key, f.id)} />{" "}
              {f.from.table.replace(/^public\./, "")}.{f.from.columns.join(",")} → {f.to.table.replace(/^public\./, "")}.{f.to.columns.join(",")}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
