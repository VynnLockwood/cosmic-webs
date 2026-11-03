import type { BoolOp, Cmp } from "../../types";
import type { ColumnInfo, Draft, EditLeaf } from "./draft";
import { Combobox } from "../Combobox";
import { addGroup, addLeaf, cmpOptionsFor, isGroup, removeNode, toggleNot, toggleOp, type Path } from "./searchTree";
import { ValueInput, type GetValues } from "./ValueInput";

interface Props { tree: Draft | null; columns: ColumnInfo[]; defaultCol: string; onChange(t: Draft | null): void; getValues?: GetValues }

function setAt(t: Draft, path: Path, fn: (l: EditLeaf) => EditLeaf): Draft {
  if (path.length === 0) return isGroup(t) ? t : fn(t);
  if (!isGroup(t)) return t;
  return { ...t, children: t.children.map((c, i) => (i === path[0] ? setAt(c, path.slice(1), fn) : c)) };
}

export function ConditionEditor({ tree, columns, defaultCol, onChange, getValues }: Props) {
  const typeOf = (col: string) => columns.find((c) => c.full === col)?.type ?? "text";
  const newLeaf = (): EditLeaf => ({ col: defaultCol, cmp: "=", raw: "" });
  const colOptions = columns.map((c) => ({ value: c.full, label: c.name, hint: c.type, group: c.table }));

  const leafRow = (l: EditLeaf, path: Path) => (
    <div className="row" key={path.join(".")}>
      <Combobox ariaLabel="Condition column" value={l.col} options={colOptions} placeholder="search column…" style={{ flex: 2, minWidth: 0 }}
        onPick={(col) => onChange(setAt(tree!, path, (x) => ({ ...x, col, raw: col === x.col ? x.raw : "", cmp: cmpOptionsFor(typeOf(col)).includes(x.cmp) ? x.cmp : "=" })))} />
      <select aria-label="Condition operator" value={l.cmp} onChange={(e) => onChange(setAt(tree!, path, (x) => ({ ...x, cmp: e.target.value as Cmp })))} style={{ flex: 1.3 }}>
        {cmpOptionsFor(typeOf(l.col)).map((c) => <option key={c}>{c}</option>)}
      </select>
      <ValueInput col={l.col} cmp={l.cmp} raw={l.raw} getValues={getValues} onChange={(raw) => onChange(setAt(tree!, path, (x) => ({ ...x, raw })))} />
      <button className="btn ghost" aria-label="Remove condition" onClick={() => onChange(removeNode(tree!, path))}>×</button>
    </div>
  );

  const view = (n: Draft, path: Path): React.ReactNode => {
    if (!isGroup(n)) return leafRow(n, path);
    return (
      <div key={path.join(".")} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 8, margin: "6px 0" }}>
        <div className="row">
          <button className="btn ghost" aria-label="Toggle AND/OR" onClick={() => onChange(toggleOp(tree!, path))}>{n.op}</button>
          <button className={n.not ? "btn" : "btn ghost"} aria-label="Toggle NOT" aria-pressed={!!n.not} title="Negate this group: NOT (…)" onClick={() => onChange(toggleNot(tree!, path))}>NOT</button>
          <button className="btn ghost" onClick={() => onChange(addLeaf(tree, path, newLeaf()))}>+ Condition</button>
          <button className="btn ghost" onClick={() => onChange(addGroup(tree, path, (n.op === "AND" ? "OR" : "AND") as BoolOp, newLeaf()))}>+ Group</button>
          {path.length > 0 && <button className="btn ghost" aria-label="Remove group" onClick={() => onChange(removeNode(tree!, path))}>×</button>}
        </div>
        {n.children.map((c, i) => view(c, [...path, i]))}
      </div>
    );
  };

  if (!tree) return <button className="btn ghost" onClick={() => onChange(addLeaf(null, [], newLeaf()))}>+ Condition</button>;
  return <>{view(isGroup(tree) ? tree : { op: "AND" as BoolOp, children: [tree] }, [])}</>;
}
