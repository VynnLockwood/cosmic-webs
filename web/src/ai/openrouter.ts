import type { ChatMessage } from "./prompt";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class AiError extends Error {}

interface Opts { apiKey: string; model: string; messages: ChatMessage[]; signal?: AbortSignal }

/** One chat completion from OpenRouter, straight from the browser. Returns the model's text. */
export async function askOpenRouter({ apiKey, model, messages, signal }: Opts, fetchImpl: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "X-Title": "Cosmic Webs" },
      body: JSON.stringify({ model: model.trim(), messages, temperature: 0.1 }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new AiError("Cancelled.");
    throw new AiError(`Could not reach OpenRouter (${e?.message ?? "network error"}). Check your connection.`);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message ? `: ${body.error.message}` : "";
    if (res.status === 401) throw new AiError(`OpenRouter did not accept the API key${detail}`);
    if (res.status === 402) throw new AiError(`OpenRouter says the account is out of credits${detail}`);
    if (res.status === 404) throw new AiError(`OpenRouter does not know the model "${model}"${detail}`);
    if (res.status === 429) throw new AiError(`OpenRouter is rate limiting this key or model; wait a moment${detail}`);
    throw new AiError(`OpenRouter error ${res.status}${detail}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AiError(body?.error?.message ?? "The model sent an empty answer. Try again or pick another model.");
  return text;
}
