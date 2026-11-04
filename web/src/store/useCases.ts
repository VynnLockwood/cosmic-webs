/**
 * Use cases: a named snapshot of what you want to see (the plain-words wish, the search builder, your joins,
 * the AI's SQL) plus the settings you had. Kept in this browser's localStorage. The OpenRouter key is never copied in.
 */
import type { AiSql } from "../ai/parseAnswer";
import type { VJoin } from "../search/virtualJoins";
import type { Draft } from "../ui/search/draft";
import { emptyShape, type ShapeDraft } from "../ui/search/shape";
import { normalizeVisual, type VisualSettings } from "./visualSettings";

export interface CaseSettings {
  visual: VisualSettings;
  sqlMode: "params" | "hardcoded";
  panelWidths: { drawer: number | null; panel: number | null };
  tier: "auto" | "high" | "medium" | "low";
  reducedMotion: boolean;
}

export interface UseCase {
  id: string;
  name: string;
  savedAt: number;
  goal: string;
  select: string[];
  draft: Draft | null;
  shape: ShapeDraft;
  joins: VJoin[];
  aiSql: AiSql[];
  fkChoices: Record<string, string>;
  settings: CaseSettings;
}

export interface CaseBook { items: UseCase[]; /** id of the one used last */ last: string | null; /** open the last one when the app starts */ autoOpen: boolean }

export const CASES_KEY = "cosmos.cases";
export const emptyBook = (): CaseBook => ({ items: [], last: null, autoOpen: true });

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const width = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** One saved case read back; null when it is too broken to use. Each part is checked on its own. */
export function normalizeCase(v: any): UseCase | null {
  if (!v || typeof v !== "object" || typeof v.id !== "string" || typeof v.name !== "string" || v.name.trim() === "") return null;
  const s = v.settings ?? {};
  const tier = s.tier;
  return {
    id: v.id,
    name: v.name,
    savedAt: Number(v.savedAt) || 0,
    goal: str(v.goal),
    select: arr<unknown>(v.select).filter((x): x is string => typeof x === "string"),
    draft: v.draft && typeof v.draft === "object" ? (v.draft as Draft) : null,
    shape: { ...emptyShape(), ...(v.shape && typeof v.shape === "object" ? v.shape : {}) },
    joins: arr<any>(v.joins).filter((j) => typeof j?.from === "string" && typeof j?.to === "string"),
    aiSql: arr<any>(v.aiSql).filter((q) => typeof q?.sql === "string").map((q) => ({ title: str(q.title, "AI query"), sql: q.sql, params: arr<unknown>(q.params) })),
    fkChoices: v.fkChoices && typeof v.fkChoices === "object" ? v.fkChoices : {},
    settings: {
      visual: normalizeVisual(s.visual),
      sqlMode: s.sqlMode === "params" ? "params" : "hardcoded",
      panelWidths: { drawer: width(s.panelWidths?.drawer), panel: width(s.panelWidths?.panel) },
      tier: tier === "high" || tier === "medium" || tier === "low" ? tier : "auto",
      reducedMotion: s.reducedMotion === true,
    },
  };
}

export function loadCases(): CaseBook {
  try {
    const v = JSON.parse(localStorage.getItem(CASES_KEY) ?? "null");
    const items = arr<unknown>(v?.items).map(normalizeCase).filter((c): c is UseCase => c !== null);
    return { items, last: items.some((c) => c.id === v?.last) ? v.last : null, autoOpen: v?.autoOpen !== false };
  } catch {
    return emptyBook();
  }
}

/** false when the browser refused (full or private mode); the book still works until reload */
export function saveCases(b: CaseBook): boolean {
  try { localStorage.setItem(CASES_KEY, JSON.stringify(b)); return true; } catch { return false; }
}

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** A few words about what a case holds, for the list. */
export function summaryOf(c: UseCase): string {
  const bits: string[] = [];
  if (c.goal.trim()) bits.push("wish");
  if (c.select.length) bits.push(`${c.select.length} column${c.select.length === 1 ? "" : "s"}`);
  if (c.draft) bits.push("filters");
  if (c.joins.length) bits.push(`${c.joins.length} join${c.joins.length === 1 ? "" : "s"}`);
  if (c.aiSql.length) bits.push(`${c.aiSql.length} AI SQL`);
  bits.push("settings");
  return bits.join(" · ");
}
