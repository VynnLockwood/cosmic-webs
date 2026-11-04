import { useStore } from "./useStore";
import { emptyBook, newId, saveCases, type CaseBook, type UseCase } from "./useCases";

const put = (book: CaseBook) => {
  saveCases(book);
  useStore.setState({ cases: book });
};

/** Save what is on screen under `name`. The same name (any letter case) is replaced. Returns the case, or null for an empty name. */
export function saveCurrentCase(name: string): UseCase | null {
  const n = name.trim();
  if (!n) return null;
  const s = useStore.getState();
  const old = s.cases.items.find((c) => c.name.toLowerCase() === n.toLowerCase());
  const c: UseCase = {
    id: old?.id ?? newId(),
    name: n,
    savedAt: Date.now(),
    goal: s.aiGoal,
    select: [...s.searchSelect],
    draft: s.searchDraft ? structuredClone(s.searchDraft) : null,
    shape: structuredClone(s.searchShape),
    joins: s.searchJoins.map((j) => ({ ...j })),
    aiSql: s.aiSql.map((q) => ({ ...q })),
    fkChoices: { ...s.fkChoices },
    settings: { visual: { ...s.visual }, sqlMode: s.sqlMode, panelWidths: { ...s.panelWidths }, tier: s.tier, reducedMotion: s.reducedMotion },
  };
  const items = old ? s.cases.items.map((x) => (x.id === old.id ? c : x)) : [...s.cases.items, c];
  put({ ...s.cases, items, last: c.id });
  return c;
}

/**
 * Put a case back. `withSettings: false` brings back only the search (used at start-up, when the settings are already saved).
 * Columns the open database does not have are left out; their names are returned.
 */
export function applyCase(id: string, o: { withSettings?: boolean; openSearch?: boolean } = {}): { missing: string[] } | null {
  const s = useStore.getState();
  const c = s.cases.items.find((x) => x.id === id);
  if (!c) return null;
  const have = new Set((s.graph?.tables ?? []).flatMap((t) => t.columns.map((col) => `${t.name}.${col.name}`)));
  const missing = s.graph ? c.select.filter((x) => !have.has(x)) : [];
  s.setAiGoal(c.goal);
  s.setSearchSelect(s.graph ? c.select.filter((x) => have.has(x)) : [...c.select]);
  s.setSearchDraft(c.draft ? structuredClone(c.draft) : null);
  s.setSearchShape(structuredClone(c.shape));
  s.setSearchJoins(c.joins.map((j) => ({ ...j })));
  s.setAiSql(c.aiSql.map((q) => ({ ...q })));
  s.setFkChoices({ ...c.fkChoices });
  if (o.withSettings !== false) {
    s.setVisual(c.settings.visual);
    s.setSqlMode(c.settings.sqlMode);
    s.setPanelWidth("drawer", c.settings.panelWidths.drawer);
    s.setPanelWidth("panel", c.settings.panelWidths.panel);
    s.setTier(c.settings.tier);
    s.setReducedMotion(c.settings.reducedMotion);
  }
  if (o.openSearch) s.setDrawer("search");
  put({ ...useStore.getState().cases, last: c.id });
  return { missing };
}

export function renameCase(id: string, name: string): boolean {
  const n = name.trim();
  const b = useStore.getState().cases;
  if (!n || b.items.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) return false;
  put({ ...b, items: b.items.map((c) => (c.id === id ? { ...c, name: n } : c)) });
  return true;
}

export function deleteCase(id: string): void {
  const b = useStore.getState().cases;
  put({ ...b, items: b.items.filter((c) => c.id !== id), last: b.last === id ? null : b.last });
}

export function setAutoOpen(v: boolean): void {
  put({ ...useStore.getState().cases, autoOpen: v });
}

/** At start (after the database is on screen): bring back the search you used last. */
export function openLastCase(): void {
  const b = useStore.getState().cases;
  if (b.autoOpen && b.last) applyCase(b.last, { withSettings: false });
}

export const forgetAllCases = () => put(emptyBook());
