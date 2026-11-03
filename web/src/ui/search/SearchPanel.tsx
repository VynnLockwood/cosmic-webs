import { useState } from "react";
import { runSearch } from "../../search/runSearch";
import { useStore } from "../../store/useStore";
import { ColumnPicker, useColumns } from "./ColumnPicker";
import { ConditionEditor } from "./ConditionEditor";
import { draftToCond } from "./draft";
import { toRequest } from "./searchTree";
import { JoinsEditor } from "./JoinsEditor";
import { QueryShape } from "./QueryShape";
import { shapeToRequest } from "./shape";
import { joinErrors, withJoins } from "../../search/virtualJoins";
import type { GetValues } from "./ValueInput";

export function SearchPanel({ getValues }: { getValues?: GetValues } = {}) {
  const cols = useColumns();
  const select = useStore((s) => s.searchSelect);
  const draft = useStore((s) => s.searchDraft);
  const shape = useStore((s) => s.searchShape);
  const joins = useStore((s) => s.searchJoins);
  const importing = useStore((s) => s.importProgress !== null);
  const setDraft = useStore((s) => s.setSearchDraft);
  const measure = useStore((s) => s.measureTime);
  const includeSplit = useStore((s) => s.includeSplit);
  const mode = useStore((s) => s.sourceMode);
  const setOpts = useStore((s) => s.setSearchOptions);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const canRun = select.length > 0 || shape.aggregates.length > 0 || shape.groupBy.length > 0;
  const run = async () => {
    const { cond, errors } = draftToCond(draft, (c) => cols.find((x) => x.full === c)?.type);
    const sh = shapeToRequest(shape);
    const graph = useStore.getState().graph ?? { tables: [], fks: [] };
    const all = [...errors, ...sh.errors, ...joinErrors(graph, joins)];
    setErrors(all);
    if (all.length) return;
    const s = useStore.getState();
    const req = toRequest(select, cond, s.fkChoices, sh.fields);
    s.setSearch(req);
    setBusy(true);
    try {
      const out = await runSearch(req, withJoins(graph, joins));
      s.setResults(out.ranked, out.flags, { candidates: out.candidates, costs: out.costs, splitHidden: out.splitHidden });
      s.setDrawer("results");
    } catch (e: any) {
      setErrors([String(e?.message ?? e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Search</h2>
      <h3>Columns to fetch</h3>
      <ColumnPicker />
      <h3>Conditions</h3>
      <ConditionEditor tree={draft} columns={cols} defaultCol={select[0] ?? cols[0]?.full ?? ""} onChange={setDraft} getValues={getValues} />
      <JoinsEditor />
      <QueryShape />
      <h3>Ranking</h3>
      <label className="row" style={{ cursor: mode === "sandbox" ? "pointer" : "not-allowed" }}>
        <input type="checkbox" checked={measure && mode === "sandbox"} disabled={mode !== "sandbox"} onChange={(e) => setOpts({ measureTime: e.target.checked })} />
        <span>Measure real run time {mode !== "sandbox" && <span style={{ color: "var(--ui-muted)" }}>(sandbox only; live uses the planner estimate)</span>}</span>
      </label>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={includeSplit} onChange={(e) => setOpts({ includeSplit: e.target.checked })} />
        <span>Include split plans <span style={{ color: "var(--ui-muted)" }}>(separate result sets, not one table)</span></span>
      </label>
      {errors.map((e, i) => <div key={i} className="err" role="alert">{e}</div>)}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={run} disabled={busy || importing || !canRun}>{busy ? "Searching…" : importing ? "Import running…" : "Search"}</button>
        {!canRun && <span style={{ color: "var(--ui-muted)" }}>Pick at least one column (or an aggregate).</span>}
      </div>
    </>
  );
}
