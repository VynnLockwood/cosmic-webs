import type { Cmp, Cond } from "../../types";
import { isGroup, parseValue, type Node } from "./searchTree";

/** A condition as typed in the editor: the value is still raw text. */
export interface EditLeaf { col: string; cmp: Cmp; raw: string }
export type Draft = Node<EditLeaf>;

export interface ColumnInfo { full: string; table: string; name: string; type: string }

/** Parse every raw value by its column type. Returns the Cond tree (or null) and one message per bad condition. */
export function draftToCond(draft: Draft | null, typeOf: (col: string) => string | undefined): { cond: Cond | null; errors: string[] } {
  const errors: string[] = [];
  const walk = (n: Draft): Cond | null => {
    if (isGroup(n)) {
      const kids = n.children.map(walk).filter((x): x is Cond => x !== null);
      if (!kids.length) return null;
      const g: Cond = { op: n.op, children: kids };
      return n.not ? { not: g } : g;
    }
    const t = typeOf(n.col);
    if (t === undefined) {
      errors.push(`${n.col}: unknown column`);
      return null;
    }
    const r = parseValue(t, n.cmp, n.raw);
    if (!r.ok) {
      errors.push(`${n.col}: ${r.error}`);
      return null;
    }
    return r.value === undefined ? { col: n.col, cmp: n.cmp } : { col: n.col, cmp: n.cmp, value: r.value };
  };
  return { cond: draft ? walk(draft) : null, errors };
}
