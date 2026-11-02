import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// These need the real stack: the Rust WASM core (WASM_REAL=1, after `npm run wasm`) and the API + Postgres (E2E_REAL_API=1).
test.skip(!process.env.WASM_REAL || !process.env.E2E_REAL_API, "needs real WASM core and API");

async function pick(page: any, filter: string, col: string) {
  await page.getByLabel("Filter columns").fill(filter);
  await page.getByRole("checkbox", { name: col, exact: true }).check();
}

test("ranked_results_shown", async ({ page }) => {
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Search" }).first().click();
  await pick(page, "users.email", "public.users.email");
  await pick(page, "orders.total", "public.orders.total");
  await page.getByRole("button", { name: "+ Condition" }).click();
  await page.getByLabel("Condition column").selectOption("public.orders.status");
  await page.getByLabel("Condition value").fill("0");
  await page.getByRole("button", { name: "Search", exact: true }).last().click();
  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  expect(await cards.count()).toBeLessThanOrEqual(5);
  await expect(cards.first()).toContainText("JOIN");
});

test("unreachable_flag_flies_to_table", async ({ page }) => {
  // needs a schema with an isolated table: load one through the schema drawer
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Schema" }).click();
  await page.getByLabel("DDL").fill("create table users(id serial primary key, email text); create table iso(id serial primary key, x text);");
  await page.getByRole("button", { name: "Build web" }).click();
  await page.waitForFunction(() => (window as any).__cosmos.dotCount === 2);
  await page.getByRole("button", { name: "Search" }).first().click();
  await pick(page, "users.email", "public.users.email");
  await pick(page, "iso.x", "public.iso.x");
  await page.getByRole("button", { name: "Search", exact: true }).last().click();
  await expect(page.getByText("UNREACHABLE")).toBeVisible({ timeout: 30_000 });
  await page.getByText("UNREACHABLE").click();
  await page.waitForFunction(() => (window as any).__cosmos.state().selectedTable === "public.iso");
});

test("percent_value_searches_safely", async ({ page }) => {
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Search" }).first().click();
  await pick(page, "users.email", "public.users.email");
  await page.getByRole("button", { name: "+ Condition" }).click();
  await page.getByLabel("Condition column").selectOption("public.users.name");
  await page.getByLabel("Condition operator").selectOption("ILIKE");
  await page.getByLabel("Condition value").fill("50%'; --");
  await page.getByRole("button", { name: "Search", exact: true }).last().click();
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Run" }).first().click();
  await expect(page.getByText("0 rows")).toBeVisible();
});
