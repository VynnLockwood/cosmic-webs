import { useStore } from "../store/useStore";
import { draftToCond } from "../ui/search/draft";
import { toRequest } from "../ui/search/searchTree";
import { shapeToRequest } from "../ui/search/shape";
import { runSearch } from "./runSearch";
import { joinErrors, withJoins } from "./virtualJoins";

/** Build the request from the search builder (and the model's SQL), run it, show the results. Returns the messages that stopped it, if any. */
export async function executeSearch(): Promise<string[]> {
  const s = useStore.getState();
  const graph = s.graph ?? { tables: [], fks: [] };
  const type = (c: string) => graph.tables.find((t) => c.startsWith(t.name + "."))?.columns.find((x) => x.name === c.slice(c.lastIndexOf(".") + 1))?.type;
  const { cond, errors } = draftToCond(s.searchDraft, type);
  const sh = shapeToRequest(s.searchShape);
  const all = [...errors, ...sh.errors, ...joinErrors(graph, s.searchJoins)];
  if (all.length) return all;
  const req = toRequest(s.searchSelect, cond, s.fkChoices, sh.fields);
  s.setSearch(req);
  try {
    const out = await runSearch(req, withJoins(graph, s.searchJoins));
    s.setResults(out.ranked, out.flags, { candidates: out.candidates, costs: out.costs, splitHidden: out.splitHidden });
    s.setDrawer("results");
    return [];
  } catch (e: any) {
    return [String(e?.message ?? e)];
  }
}
