import { expect, test } from "@playwright/test";
import { mockApi, open, shop, shopSql } from "./helpers";

const small = { tables: ["a", "b", "c"].map((n) => ({ name: `public.${n}`, columns: [], row_estimate: 0 })), fks: [] };
const count = (page: any) => page.evaluate(() => (window as any).__cosmos.dotCount);

test("upload_shop_sql_gives_25_dots", async ({ page }) => {
  await mockApi(page, small);
  await page.route("**/api/schema", (r) => r.request().method() === "POST" ? r.fulfill({ json: { graph: shop, warnings: [] } }) : r.continue());
  await open(page, "e2e=1&tier=low");
  expect(await count(page)).toBe(3);
  await page.getByRole("button", { name: "Schema" }).click();
  await page.getByLabel("Upload schema file").setInputFiles({ name: "shop.sql", mimeType: "text/plain", buffer: Buffer.from(shopSql) });
  await page.waitForFunction(() => (window as any).__cosmos.dotCount === 25);
  await expect(page.locator(".hud").getByText("25 tables")).toBeVisible();
});

test("invalid_ddl_shows_error_dotcount_unchanged", async ({ page }) => {
  await mockApi(page, small);
  await page.route("**/api/schema", (r) => r.request().method() === "POST" ? r.fulfill({ status: 422, json: { message: 'syntax error at or near "tabel"', line: 2, col: 8 } }) : r.continue());
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Schema" }).click();
  await page.getByLabel("DDL").fill("create table a(id int);\ncreate tabel b(id int);");
  await page.getByRole("button", { name: "Build web" }).click();
  await expect(page.getByRole("alert")).toContainText("Line 2, col 8");
  expect(await count(page)).toBe(3);
});

test("live_connect_bad_host_shows_message", async ({ page }) => {
  await mockApi(page, small);
  await page.route("**/api/source/live", (r) => r.fulfill({ status: 400, json: { message: "connection refused" } }));
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Data source" }).click();
  await page.getByLabel("Database").fill("x");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert")).toHaveText("connection refused");
});
