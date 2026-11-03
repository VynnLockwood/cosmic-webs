/** OpenRouter key and model. Kept only in this browser's localStorage; sent only to openrouter.ai. */
export interface AiSettings { apiKey: string; model: string }
export const AI_KEY = "cosmos.ai";
export const EMPTY_AI: AiSettings = { apiKey: "", model: "" };
/** Examples only; any OpenRouter model id can be typed. */
export const MODEL_EXAMPLES = ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5", "meta-llama/llama-3.1-70b-instruct"];

export function loadAi(): AiSettings {
  try {
    const v = JSON.parse(localStorage.getItem(AI_KEY) ?? "null");
    return { apiKey: typeof v?.apiKey === "string" ? v.apiKey : "", model: typeof v?.model === "string" ? v.model : "" };
  } catch {
    return { ...EMPTY_AI };
  }
}
export function saveAi(a: AiSettings): void {
  try { localStorage.setItem(AI_KEY, JSON.stringify(a)); } catch { /* private mode: lasts for this visit */ }
}
export function clearAi(): void {
  try { localStorage.removeItem(AI_KEY); } catch { /* ignore */ }
}
export const aiReady = (a: AiSettings) => a.apiKey.trim() !== "" && a.model.trim() !== "";
