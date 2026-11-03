import { Combobox, type ComboOption } from "../Combobox";
import { useColumns } from "./ColumnPicker";
import { useStore } from "../../store/useStore";

/** Declare a join for this search: use it when two tables have no foreign key but a column in each holds the same values. */
export function JoinsEditor() {
  const cols = useColumns();
  const joins = useStore((s) => s.searchJoins);
  const set = useStore((s) => s.setSearchJoins);
  const options: ComboOption[] = cols.map((c) => ({ value: c.full, label: c.name, hint: c.type, group: c.table }));
  const edit = (i: number, p: Partial<{ from: string; to: string }>) => set(joins.map((j, k) => (k === i ? { ...j, ...p } : j)));
  return (
    <details open={joins.length > 0} className="shape">
      <summary><h3 style={{ display: "inline" }}>Joins</h3> <span style={{ color: "var(--ui-muted)" }}>link tables that have no foreign key</span></summary>
      <p style={{ margin: "6px 0", color: "var(--ui-muted)", fontSize: 12 }}>Rows match when the two columns are equal. Used for this search only; your database is not changed. Without a join, tables with no link would pair every row with every row.</p>
      {joins.map((j, i) => (
        <div className="row" key={i}>
          <Combobox ariaLabel={`Join ${i + 1} left column`} value={j.from} options={options} placeholder="search column…" style={{ flex: 1, minWidth: 0 }} onPick={(v) => edit(i, { from: v })} />
          <span aria-hidden>=</span>
          <Combobox ariaLabel={`Join ${i + 1} right column`} value={j.to} options={options} placeholder="search column…" style={{ flex: 1, minWidth: 0 }} onPick={(v) => edit(i, { to: v })} />
          <button className="btn ghost" aria-label={`Remove join ${i + 1}`} onClick={() => set(joins.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => set([...joins, { from: "", to: "" }])}>+ Join</button>
    </details>
  );
}
