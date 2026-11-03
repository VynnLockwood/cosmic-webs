import { expect, test } from "@playwright/test";
import { mockApi, open } from "./helpers";

test("expected result: key and model live in localStorage, the model sees only names, the builder gets filled", async ({ page }) => {
  await mockApi(page);
  let seen: { auth?: string; body?: string } = {};
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    seen = { auth: route.request().headers()["authorization"], body: route.request().postData() ?? "" };
    const answer = { explanation: "Emails with their order totals.", request: { select: ["public.users.email", "public.orders.total"], limit: 10 } };
    await route.fulfill({ json: { choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }, headers: { "access-control-allow-origin": "*" } });
  });
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouter API key").fill("sk-or-test-123");
  await page.getByLabel("Model", { exact: true }).fill("openai/gpt-4o-mini");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cosmos.ai")!))).toEqual({ apiKey: "sk-or-test-123", model: "openai/gpt-4o-mini" });
  await page.reload();
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0);
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByLabel("Describe the result you expect").fill("each customer's email and what they paid, top 10");
  await page.getByLabel("Run the search right after").uncheck();
  await page.getByRole("button", { name: "Ask AI" }).click();
  await expect(page.getByLabel("AI answer")).toContainText("Emails with their order totals.");
  await expect(page.getByLabel("Remove public.users.email")).toBeVisible();
  expect(seen.auth).toBe("Bearer sk-or-test-123");
  expect(seen.body).toContain("public.users(");
  expect(seen.body).not.toMatch(/"row_estimate"|1000/); // names and types only
});
