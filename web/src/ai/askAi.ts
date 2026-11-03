import { useStore } from "../store/useStore";
import type { SchemaGraph } from "../types";
import { aiReady, type AiSettings } from "./aiSettings";
import { requestToBuilder } from "./applyAnswer";
import { askOpenRouter } from "./openrouter";
import { parseAiAnswer, type AiAnswer } from "./parseAnswer";
import { buildMessages } from "./prompt";
import { schemaDigest } from "./schemaDigest";

export interface AskInfo { tables: number; total: number }

/** Ask the model for queries that reach `goal`. Only table and column names and types leave the browser; the database is never touched. */
export async function askAi(goal: string, graph: SchemaGraph, ai: AiSettings, fetchImpl: typeof fetch = fetch, info?: (i: AskInfo) => void): Promise<AiAnswer> {
  if (goal.trim() === "") throw new Error("Describe the result you want to see first.");
  if (!aiReady(ai)) throw new Error("Add your OpenRouter API key and model in Settings first.");
  const d = schemaDigest(graph, goal);
  info?.({ tables: d.tables, total: d.total });
  const text = await askOpenRouter({ apiKey: ai.apiKey, model: ai.model, messages: buildMessages(goal, d.text, d.tables, d.total) }, fetchImpl);
  return parseAiAnswer(text, graph);
}

/** Show the answer in the search builder; the person reviews it and presses Search (or it runs right away). */
export function applyAiAnswer(a: AiAnswer): void {
  const s = useStore.getState();
  if (a.request) {
    const b = requestToBuilder(a.request);
    s.setSearchSelect(b.select);
    s.setSearchDraft(b.draft);
    s.setSearchShape(b.shape);
  } else {
    s.setSearchSelect([]);
    s.setSearchDraft(null);
    s.setSearchShape({ ...s.searchShape, distinct: false, limit: "", offset: "", orderBy: [], aggregates: [], groupBy: [], having: [] });
  }
  s.setSearchJoins(a.joins);
  s.setAiSql(a.sqls);
}
