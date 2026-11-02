import type { BoolOp, Cmp } from "../../types";
import type { ColumnInfo, Draft, EditLeaf } from "./draft";
import { addGroup, addLeaf, cmpOptionsFor, isGroup, removeNode, toggleOp, type Path } from "./searchTree";

interface Props { tree: Draft | null; columns: ColumnInfo[]; defaultCol: string; onChange(t: Draft | null): void }

const placeholder = (cmp: Cmp) => (cmp === "BETWEEN" ? "low,high" : cmp === "IN" || cmp === "NOT IN" ? "a,b,c" : cmp.startsWith("IS") ? "" : "value");

function setAt(t: Draft, path: Path, fn: (l: EditLeaf) => EditLeaf): Draft {
  if (path.length === 0) return isGroup(t) ? t : fn(t);
  if (!isGroup(t)) return t;
  return { ...t, children: t.children.map((c, i) => (i === path[0] ? setAt(c, path.slice(1), fn) : c)) };
}

export function ConditionEditor({ tree, columns, defaultCol, onChange }: Props) {
  const typeOf = (col: string) => columns.find((c) => c.full === col)?.type ?? "text";
  const newLeaf = (): EditLeaf => ({ col: defaultCol, cmp: "=", raw: "" });
  const byTable = new Map<string, ColumnInfo[]>();
  for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);

  const leafRow = (l: EditLeaf, path: Path) => (
    <div className="row" key={path.join(".")}>
      <select aria-label="Condition column" value={l.col} onChange={(e) => onChange(setAt(tree!, path, (x) => ({ ...x, col: e.target.value, cmp: cmpOptionsFor(typeOf(e.target.value)).includes(x.cmp) ? x.cmp : "=" })))} style={{ flex: 2 }}>
        {[...byTable].map(([t, cs]) => <optgroup key={t} label={t}>{cs.map((c) => <option key={c.full} value={c.full}>{c.name}</option>)}</optgroup>)}
      </select>
      <select aria-label="Condition operator" value={l.cmp} onChange={(e) => onChange(setAt(tree!, path, (x) => ({ ...x, cmp: e.target.value as Cmp })))} style={{ flex: 1.3 }}>
        {cmpOptionsFor(typeOf(l.col)).map((c) => <option key={c}>{c}</option>)}
      </select>
      <input aria-label="Condition value" value={l.raw} placeholder={placeholder(l.cmp)} disabled={l.cmp.startsWith("IS")} onChange={(e) => onChange(setAt(tree!, path, (x) => ({ ...x, raw: e.target.value })))} style={{ flex: 2 }} />
      <button className="btn ghost" aria-label="Remove condition" onClick={() => onChange(removeNode(tree!, path))}>×</button>
    </div>
  );

  const view = (n: Draft, path: Path): React.ReactNode => {
    if (!isGroup(n)) return leafRow(n, path);
    return (
      <div key={path.join(".")} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 8, margin: "6px 0" }}>
        <div className="row">
          <button className="btn ghost" aria-label="Toggle AND/OR" onClick={() => onChange(toggleOp(tree!, path))}>{n.op}</button>
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
