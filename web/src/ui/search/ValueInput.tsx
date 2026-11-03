import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Cmp, ColumnValues } from "../../types";
import { Combobox, type ComboOption } from "../Combobox";

export type GetValues = (table: string, column: string, q?: string) => Promise<ColumnValues>;
export const realGetValues: GetValues = (t, c, q) => api.getValues(t, c, q);

/** Values of a column that match the typed text (debounced). Failures just mean no suggestions. */
export function useValueOptions(col: string, getValues: GetValues): { options: ComboOption[]; onType(t: string): void; truncated: boolean } {
  const [res, setRes] = useState<ColumnValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const cut = col.lastIndexOf(".");
  const [table, column] = [col.slice(0, cut), col.slice(cut + 1)];
  const load = (q: string) => {
    const mine = ++seq.current;
    getValues(table, column, q).then((r) => mine === seq.current && setRes(r)).catch(() => mine === seq.current && setRes(null));
  };
  useEffect(() => {
    setRes(null);
    if (cut < 0) return;
    timer.current = setTimeout(() => load(""), 0);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col]);
  useEffect(() => () => { seq.current++; clearTimeout(timer.current); }, []);
  const options = useMemo(() => (res?.values ?? []).map((v) => ({ value: String(v.value), hint: `${v.count.toLocaleString("en-US")}×` })), [res]);
  return {
    options,
    truncated: res?.truncated ?? false,
    onType: (t) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => load(t), 200);
    },
  };
}

interface Props { col: string; cmp: Cmp; raw: string; onChange(raw: string): void; getValues?: GetValues }

const pair = (raw: string): [string, string] => {
  const i = raw.indexOf(",");
  return i < 0 ? [raw, ""] : [raw.slice(0, i), raw.slice(i + 1)];
};

/** The value box of a condition, with every value the column holds as a searchable list. */
export function ValueInput({ col, cmp, raw, onChange, getValues = realGetValues }: Props) {
  const { options, onType, truncated } = useValueOptions(col, getValues);
  const style = { flex: 2, minWidth: 0 };
  if (cmp === "IS NULL" || cmp === "IS NOT NULL") return <input aria-label="Condition value" disabled placeholder="" style={style} />;
  if (cmp === "BETWEEN" || cmp === "NOT BETWEEN") {
    const [lo, hi] = pair(raw);
    return (
      <div className="row" style={{ ...style, gap: 4 }}>
        <Combobox ariaLabel="Condition low value" value={lo} options={options} filter={false} allowFree onType={onType} onPick={(v) => onChange(`${v},${hi}`)} placeholder="low" />
        <Combobox ariaLabel="Condition high value" value={hi} options={options} filter={false} allowFree onType={onType} onPick={(v) => onChange(`${lo},${v}`)} placeholder="high" />
      </div>
    );
  }
  if (cmp === "IN" || cmp === "NOT IN") {
    const items = raw === "" ? [] : raw.split(",");
    const add = (v: string) => v !== "" && !items.includes(v) && onChange([...items, v].join(","));
    return (
      <div style={style}>
        <Combobox ariaLabel="Condition value" value="" options={options.filter((o) => !items.includes(o.value))} filter={false} allowFree onType={onType} onPick={add} placeholder={items.length ? "add another…" : "search values…"} />
        {items.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {items.map((v) => <button key={v} className="btn ghost mono" aria-label={`Remove ${v}`} onClick={() => onChange(items.filter((x) => x !== v).join(","))}>{v} ×</button>)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={style}>
      <Combobox ariaLabel="Condition value" value={raw} options={options} filter={false} allowFree onType={(t) => { onChange(t); onType(t); }} onPick={onChange} placeholder="value — type to search" />
      {truncated && options.length > 0 && <span style={{ fontSize: 11, color: "var(--ui-muted)" }}>top values shown; type to search all</span>}
    </div>
  );
}
