import { AiError, askOpenRouter, OPENROUTER_URL } from "./openrouter";
import { buildMessages } from "./prompt";

const msgs = buildMessages("orders per user", "public.users(id int4 PK)", 1, 1);
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("the request goes to openrouter.ai with the key and model, and carries only the schema text and the wish", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })))) as unknown as typeof fetch;
  expect(await askOpenRouter({ apiKey: " sk-or-1 ", model: " openai/x ", messages: msgs }, f)).toBe("{}");
  expect(seen!.url).toBe(OPENROUTER_URL);
  expect((seen!.init.headers as any).Authorization).toBe("Bearer sk-or-1");
  const body = JSON.parse(seen!.init.body as string);
  expect(body.model).toBe("openai/x");
  expect(JSON.stringify(body.messages)).toContain("public.users(id int4 PK)");
  expect(body.messages[1].content).toContain("orders per user");
});

test.each([
  [401, "did not accept the API key"],
  [402, "out of credits"],
  [404, 'does not know the model "m"'],
  [429, "rate limiting"],
  [500, "OpenRouter error 500"],
])("HTTP %i is explained", async (status, text) => {
  await expect(askOpenRouter({ apiKey: "k", model: "m", messages: msgs }, reply(status, { error: { message: "details" } }))).rejects.toThrow(text);
});

test("network failure and empty answers give clear errors", async () => {
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  await expect(askOpenRouter({ apiKey: "k", model: "m", messages: msgs }, down)).rejects.toThrow(/Could not reach OpenRouter/);
  await expect(askOpenRouter({ apiKey: "k", model: "m", messages: msgs }, reply(200, { choices: [{ message: { content: "  " } }] }))).rejects.toBeInstanceOf(AiError);
});

test("the prompt tells the model it sees no rows, wants read-only SQL, and lists only what the caller sent", () => {
  expect(msgs[0].content).toMatch(/never see rows/);
  expect(msgs[0].content).toMatch(/Never INSERT, UPDATE, DELETE/);
  expect(buildMessages("g", "d", 2, 9)[1].content).toContain("Only 2 of 9 tables are listed");
});
