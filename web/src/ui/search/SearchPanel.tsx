import { useState } from "react";
import { runSearch } from "../../search/runSearch";
import { useStore } from "../../store/useStore";
import { ColumnPicker, useColumns } from "./ColumnPicker";
import { ConditionEditor } from "./ConditionEditor";
import { draftToCond } from "./draft";
import { toRequest } from "./searchTree";

export function SearchPanel() {
  const cols = useColumns();
  const select = useStore((s) => s.searchSelect);
  const draft = useStore((s) => s.searchDraft);
  const setDraft = useStore((s) => s.setSearchDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const { cond, errors } = draftToCond(draft, (c) => cols.find((x) => x.full === c)?.type);
    setErrors(errors);
    if (errors.length) return;
    const s = useStore.getState();
    const req = toRequest(select, cond, s.fkChoices);
    s.setSearch(req);
    setBusy(true);
    try {
      const out = await runSearch(req);
      s.setResults(out.ranked, out.flags, { candidates: out.candidates, costs: out.costs });
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
      <ConditionEditor tree={draft} columns={cols} defaultCol={select[0] ?? cols[0]?.full ?? ""} onChange={setDraft} />
      {errors.map((e, i) => <div key={i} className="err" role="alert">{e}</div>)}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={run} disabled={busy || select.length === 0}>{busy ? "Searching…" : "Search"}</button>
        {select.length === 0 && <span style={{ color: "var(--ui-muted)" }}>Pick at least one column.</span>}
      </div>
    </>
  );
}
