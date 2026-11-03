import { Combobox, type ComboOption } from "../Combobox";
import { useColumns } from "./ColumnPicker";
import { useStore } from "../../store/useStore";
import { AGG_FUNCS, aggLabel, dropAggregate, HAVING_CMPS, isShaped, type ShapeDraft } from "./shape";
import type { AggFunc, Cmp } from "../../types";

const short = (c: string) => c.replace(/^public\./, "");

/** DISTINCT, sort, limit/offset, aggregates, group by and having. */
export function QueryShape() {
  const cols = useColumns();
  const shape = useStore((s) => s.searchShape);
  const set = useStore((s) => s.setSearchShape);
  const patch = (p: Partial<ShapeDraft>) => set({ ...shape, ...p });
  const colOptions: ComboOption[] = cols.map((c) => ({ value: c.full, label: c.name, hint: c.type, group: c.table }));
  const sortOptions: ComboOption[] = [
    ...shape.aggregates.map((a, i) => ({ value: `agg:${i}`, label: aggLabel(a), hint: "aggregate", group: "Aggregates" })),
    ...colOptions,
  ];
  const sortValue = (o: ShapeDraft["orderBy"][number]) => (o.kind === "agg" ? (shape.aggregates[o.agg] ? aggLabel(shape.aggregates[o.agg]) : "") : o.col);
  const num = (k: "limit" | "offset", label: string) => (
    <label className="row" style={{ gap: 4 }}>
      <span>{label}</span>
      <input aria-label={label} inputMode="numeric" value={shape[k]} onChange={(e) => patch({ [k]: e.target.value })} style={{ width: 70 }} placeholder="none" />
    </label>
  );
  return (
    <details open={isShaped(shape)} className="shape">
      <summary><h3 style={{ display: "inline" }}>Shape the result</h3> <span style={{ color: "var(--ui-muted)" }}>distinct, sort, limit, group, aggregates</span></summary>
      <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
        <label className="row" style={{ cursor: "pointer", gap: 4 }}>
          <input type="checkbox" checked={shape.distinct} onChange={(e) => patch({ distinct: e.target.checked })} /> <span>Distinct</span>
        </label>
        {num("limit", "Limit")}
        {num("offset", "Offset")}
      </div>

      <h3>Sort by</h3>
      {shape.orderBy.map((o, i) => (
        <div className="row" key={i}>
          <Combobox ariaLabel="Sort column" value={sortValue(o)} options={sortOptions} placeholder="search column or aggregate…" style={{ flex: 1, minWidth: 0 }}
            onPick={(v) => patch({ orderBy: shape.orderBy.map((x, k) => (k !== i ? x : v.startsWith("agg:") ? { ...x, kind: "agg" as const, agg: Number(v.slice(4)) } : { ...x, kind: "col" as const, col: v })) })} />
          <button className="btn ghost" aria-label="Sort direction" onClick={() => patch({ orderBy: shape.orderBy.map((x, k) => (k === i ? { ...x, dir: x.dir === "ASC" ? "DESC" : "ASC" } : x)) })}>{o.dir === "ASC" ? "↑ ASC" : "↓ DESC"}</button>
          <button className="btn ghost" aria-label="Remove sort" onClick={() => patch({ orderBy: shape.orderBy.filter((_, k) => k !== i) })}>×</button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => patch({ orderBy: [...shape.orderBy, { kind: "col", col: "", agg: 0, dir: "ASC" }] })}>+ Sort</button>

      <h3>Group by</h3>
      <Combobox ariaLabel="Group by column" value="" options={colOptions.filter((c) => !shape.groupBy.includes(c.value))} placeholder="search column to group by…" onPick={(v) => patch({ groupBy: [...shape.groupBy, v] })} />
      {shape.groupBy.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {shape.groupBy.map((g) => <button key={g} className="btn ghost mono" aria-label={`Remove group ${g}`} onClick={() => patch({ groupBy: shape.groupBy.filter((x) => x !== g) })}>{short(g)} ×</button>)}
        </div>
      )}

      <h3>Aggregates</h3>
      {shape.aggregates.map((a, i) => (
        <div className="row" key={i}>
          <select aria-label="Aggregate function" value={a.func} onChange={(e) => patch({ aggregates: shape.aggregates.map((x, k) => (k === i ? { ...x, func: e.target.value as AggFunc } : x)) })}>
            {AGG_FUNCS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <Combobox ariaLabel="Aggregate column" value={a.col} options={[{ value: "", label: "(all rows)", hint: "COUNT(*)" }, ...colOptions]} placeholder="column, or all rows" style={{ flex: 1, minWidth: 0 }}
            onPick={(v) => patch({ aggregates: shape.aggregates.map((x, k) => (k === i ? { ...x, col: v } : x)) })} />
          <input aria-label="Aggregate name" placeholder="name (optional)" value={a.alias} onChange={(e) => patch({ aggregates: shape.aggregates.map((x, k) => (k === i ? { ...x, alias: e.target.value } : x)) })} style={{ width: 110 }} />
          <button className="btn ghost" aria-label="Remove aggregate" onClick={() => set(dropAggregate(shape, i))}>×</button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => patch({ aggregates: [...shape.aggregates, { func: "COUNT", col: "", alias: "" }] })}>+ Aggregate</button>

      {shape.aggregates.length > 0 && (
        <>
          <h3>Having <span style={{ color: "var(--ui-muted)", fontWeight: 400 }}>(filter on an aggregate)</span></h3>
          {shape.having.map((h, i) => (
            <div className="row" key={i}>
              <select aria-label="Having aggregate" value={h.agg} onChange={(e) => patch({ having: shape.having.map((x, k) => (k === i ? { ...x, agg: Number(e.target.value) } : x)) })}>
                {shape.aggregates.map((a, k) => <option key={k} value={k}>{aggLabel(a)}</option>)}
              </select>
              <select aria-label="Having operator" value={h.cmp} onChange={(e) => patch({ having: shape.having.map((x, k) => (k === i ? { ...x, cmp: e.target.value as Cmp } : x)) })}>
                {HAVING_CMPS.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input aria-label="Having value" value={h.raw} placeholder="number" onChange={(e) => patch({ having: shape.having.map((x, k) => (k === i ? { ...x, raw: e.target.value } : x)) })} style={{ width: 90 }} />
              <button className="btn ghost" aria-label="Remove having" onClick={() => patch({ having: shape.having.filter((_, k) => k !== i) })}>×</button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => patch({ having: [...shape.having, { agg: 0, cmp: ">", raw: "" }] })}>+ Having</button>
        </>
      )}
    </details>
  );
}
