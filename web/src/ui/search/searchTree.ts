import type { BoolOp, Cmp, Cond, FkChoices, SearchRequest } from "../../types";

/** A boolean tree whose leaves are of type L (Cond for requests, draft leaves in the editor). */
export type Node<L> = { op: BoolOp; children: Node<L>[] } | L;
export type Path = number[];

export const isGroup = <L,>(n: Node<L>): n is { op: BoolOp; children: Node<L>[] } => typeof n === "object" && n !== null && "children" in n;

function update<L>(tree: Node<L>, path: Path, fn: (n: Node<L>) => Node<L>): Node<L> {
  if (path.length === 0) return fn(tree);
  if (!isGroup(tree)) throw new Error("path goes through a leaf");
  const [i, ...rest] = path;
  return { ...tree, children: tree.children.map((c, k) => (k === i ? update(c, rest, fn) : c)) };
}

function asGroup<L>(n: Node<L>): { op: BoolOp; children: Node<L>[] } {
  return isGroup(n) ? n : { op: "AND", children: [n] };
}

/** Append a leaf to the group at `path` (the root becomes an AND group when empty or a lone leaf). */
export function addLeaf<L>(tree: Node<L> | null, path: Path, leaf: L): Node<L> {
  if (tree === null) return { op: "AND", children: [leaf] };
  return update(path.length === 0 ? asGroup(tree) : tree, path, (n) => ({ ...asGroup(n), children: [...asGroup(n).children, leaf] }));
}

/** Append a nested group (optionally seeded with a first leaf) to the group at `path`. */
export function addGroup<L>(tree: Node<L> | null, path: Path, op: BoolOp, first?: L): Node<L> {
  const g: Node<L> = { op, children: first === undefined ? [] : [first] };
  const root: Node<L> = tree === null ? { op: "AND", children: [] } : tree;
  return update(path.length === 0 ? asGroup(root) : root, path, (n) => ({ ...asGroup(n), children: [...asGroup(n).children, g] }));
}

/** Remove the node at `path`; groups that become empty disappear too. Returns null when nothing is left. */
export function removeNode<L>(tree: Node<L>, path: Path): Node<L> | null {
  if (path.length === 0) return null;
  const [i, ...rest] = path;
  if (!isGroup(tree)) return tree;
  const kids: Node<L>[] = [];
  tree.children.forEach((c, k) => {
    if (k !== i) return void kids.push(c);
    const r = rest.length === 0 ? null : removeNode(c, rest);
    if (r !== null) kids.push(r);
  });
  return kids.length === 0 ? null : { ...tree, children: kids };
}

export function toggleOp<L>(tree: Node<L>, path: Path): Node<L> {
  return update(tree, path, (n) => (isGroup(n) ? { ...n, op: n.op === "AND" ? "OR" : "AND" } : n));
}

function prune(c: Cond): Cond | null {
  if (!isGroup(c)) return c;
  const kids = c.children.map(prune).filter((x): x is Cond => x !== null);
  return kids.length === 0 ? null : { ...c, children: kids };
}

/** The JSON the Rust core takes (spec §3.4); empty groups are dropped. */
export function toRequest(select: string[], tree: Cond | null, fkChoices: FkChoices): SearchRequest {
  return { select, where: tree ? prune(tree) : null, fk_choices: fkChoices };
}

type Cls = "int" | "num" | "bool" | "text" | "uuid" | "json" | "other";
export function typeClass(t: string): Cls {
  if (["int2", "int4", "int8"].includes(t)) return "int";
  if (["numeric", "float4", "float8", "money"].includes(t)) return "num";
  if (t === "bool") return "bool";
  if (["text", "varchar", "bpchar", "citext", "name"].includes(t)) return "text";
  if (t === "uuid") return "uuid";
  if (t === "json" || t === "jsonb") return "json";
  return "other"; // timestamps, dates, enums: entered as text
}

export function cmpOptionsFor(pgType: string): Cmp[] {
  const nul: Cmp[] = ["IS NULL", "IS NOT NULL"];
  switch (typeClass(pgType)) {
    case "bool": return ["=", "!=", ...nul];
    case "text": return ["=", "!=", "<", "<=", ">", ">=", "LIKE", "ILIKE", "IN", "NOT IN", "BETWEEN", ...nul];
    case "uuid": case "other": return ["=", "!=", "IN", "NOT IN", ...nul];
    case "json": return ["=", "!=", ...nul];
    default: return ["=", "!=", "<", "<=", ">", ">=", "IN", "NOT IN", "BETWEEN", ...nul];
  }
}

type Parsed = { ok: true; value?: unknown } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(cls: Cls, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (cls) {
    case "int": {
      const n = Number(raw);
      return /^-?\d+$/.test(raw.trim()) && Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false, error: `"${raw}" is not a whole number` };
    }
    case "num": {
      const n = Number(raw);
      return raw.trim() !== "" && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${raw}" is not a number` };
    }
    case "bool":
      return /^(true|false)$/i.test(raw.trim()) ? { ok: true, value: raw.trim().toLowerCase() === "true" } : { ok: false, error: "use true or false" };
    case "uuid":
      return UUID.test(raw.trim()) ? { ok: true, value: raw.trim() } : { ok: false, error: "not a valid uuid" };
    case "json":
      return { ok: true, value: raw };
    default:
      return { ok: true, value: raw };
  }
}

/** Parse the raw text typed for a condition according to the column type and comparator. */
export function parseValue(pgType: string, cmp: Cmp, raw: string): Parsed {
  const cls = typeClass(pgType);
  if (cmp === "IS NULL" || cmp === "IS NOT NULL") return { ok: true };
  if (cmp === "BETWEEN" || cmp === "IN" || cmp === "NOT IN") {
    const parts = raw.split(",").map((s) => (cls === "text" || cls === "other" ? s.trim() : s));
    if (cmp === "BETWEEN" && parts.length !== 2) return { ok: false, error: "BETWEEN needs two values: low,high" };
    if (parts.some((p) => p === "")) return { ok: false, error: "empty value in list" };
    const vals: unknown[] = [];
    for (const p of parts) {
      const r = one(cls, p);
      if (!r.ok) return r;
      vals.push(r.value);
    }
    return { ok: true, value: vals };
  }
  if (raw === "" && cls !== "text") return { ok: false, error: "enter a value" };
  return one(cls, raw);
}
