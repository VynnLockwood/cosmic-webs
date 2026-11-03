import { expect, test } from "@playwright/test";
import { mockApi, open } from "./helpers";

test("builds_request", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Search" }).first().click(); // rail button
  const filter = page.getByLabel("Filter columns");
  for (const [q, col] of [["email", "public.users.email"], ["total", "public.orders.total"], ["products.name", "public.products.name"]] as const) {
    await filter.fill(q);
    await page.getByRole("checkbox", { name: col, exact: true }).check();
  }
  await page.getByRole("button", { name: "+ Condition" }).click();
  await page.getByLabel("Condition column").selectOption("public.orders.status");
  await page.getByLabel("Condition value").fill("0");
  await page.getByRole("button", { name: "+ Condition" }).first().click();
  await page.getByLabel("Condition column").nth(1).selectOption("public.users.name");
  await page.getByLabel("Condition value").nth(1).fill("xxx");
  await page.getByRole("button", { name: "Search", exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => (window as any).__cosmos.lastRequest())).toEqual({
    select: ["public.users.email", "public.orders.total", "public.products.name"],
    where: { op: "AND", children: [{ col: "public.orders.status", cmp: "=", value: 0 }, { col: "public.users.name", cmp: "=", value: "xxx" }] },
    fk_choices: {},
  });
});

test("invalid_value_is_reported_not_sent", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByLabel("Filter columns").fill("orders.status");
  await page.getByRole("checkbox", { name: "public.orders.status", exact: true }).check();
  await page.getByRole("button", { name: "+ Condition" }).click();
  await page.getByLabel("Condition value").fill("abc");
  await page.getByRole("button", { name: "Search", exact: true }).last().click();
  await expect(page.getByRole("alert")).toContainText("not a whole number");
  expect(await page.evaluate(() => (window as any).__cosmos.lastRequest())).toBeNull();
});
