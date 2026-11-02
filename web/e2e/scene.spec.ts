import { expect, test } from "@playwright/test";
import { mockApi, open, shop } from "./helpers";

test("default_schema_renders", async ({ page }) => {
  await mockApi(page);
  await open(page);
  const hook = await page.evaluate(() => ({ d: (window as any).__cosmos.dotCount, l: (window as any).__cosmos.linkCount }));
  expect(hook.d).toBe(25);
  expect(hook.l).toBe(shop.fks.length);
  await page.waitForTimeout(1500);
  await expect(page.locator("canvas")).toBeVisible();
});

test("zero_fk_graph_has_finite_positions", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const g = { tables: ["a", "b", "c"].map((n) => ({ name: `public.${n}`, columns: [], row_estimate: 0 })), fks: [] };
  await mockApi(page, g);
  await open(page);
  expect(await page.evaluate(() => (window as any).__cosmos.dotCount)).toBe(3);
  await page.waitForTimeout(1000);
  expect(errors.filter((e) => !/WebGL|GPU|swiftshader/i.test(e))).toEqual([]);
});
