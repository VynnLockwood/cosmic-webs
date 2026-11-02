import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import type { ColumnInfo } from "./draft";

const MAX_SHOWN = 120;

export function useColumns(): ColumnInfo[] {
  const graph = useStore((s) => s.graph);
  return useMemo(() => (graph?.tables ?? []).flatMap((t) => t.columns.map((c) => ({ full: `${t.name}.${c.name}`, table: t.name, name: c.name, type: c.type }))), [graph]);
}

/** Multiselect over every column of the schema, grouped by table, type to filter. */
export function ColumnPicker() {
  const cols = useColumns();
  const selected = useStore((s) => s.searchSelect);
  const set = useStore((s) => s.setSearchSelect);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cols.filter((c) => !needle || c.full.toLowerCase().includes(needle));
  }, [cols, q]);
  const toggle = (full: string) => set(selected.includes(full) ? selected.filter((x) => x !== full) : [...selected, full]);
  const groups = new Map<string, ColumnInfo[]>();
  for (const c of shown.slice(0, MAX_SHOWN)) groups.set(c.table, [...(groups.get(c.table) ?? []), c]);
  return (
    <div>
      <input id="column-filter" aria-label="Filter columns" placeholder="Filter columns… (press / to focus)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {selected.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {selected.map((s) => (
            <button key={s} className="btn ghost mono" onClick={() => toggle(s)} title="Remove" aria-label={`Remove ${s}`}>{s.replace(/^public\./, "")} ×</button>
          ))}
        </div>
      )}
      <div style={{ maxHeight: 220, overflow: "auto", marginTop: 6 }} role="group" aria-label="Columns">
        {[...groups].map(([table, items]) => (
          <div key={table}>
            <h3 style={{ margin: "8px 0 2px" }} className="mono">{table.replace(/^public\./, "")}</h3>
            {items.map((c) => (
              <label key={c.full} className="mono" style={{ display: "flex", gap: 6, alignItems: "center", padding: "1px 0", cursor: "pointer" }}>
                <input type="checkbox" aria-label={c.full} checked={selected.includes(c.full)} onChange={() => toggle(c.full)} />
                {c.name} <span style={{ color: "var(--ui-muted)" }}>{c.type}</span>
              </label>
            ))}
          </div>
        ))}
        {shown.length > MAX_SHOWN && <div className="warn">Showing {MAX_SHOWN} of {shown.length}; keep typing to narrow.</div>}
        {shown.length === 0 && <div style={{ color: "var(--ui-muted)" }}>No matching columns.</div>}
      </div>
    </div>
  );
}
