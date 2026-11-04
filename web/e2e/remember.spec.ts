import { expect, test } from "@playwright/test";
import { mockApi, open, shop } from "./helpers";

const ddl = "CREATE TABLE a (id int primary key);\n" + "-- " + "x".repeat(200);

test("the pasted database is kept in IndexedDB and loads by itself after a reload", async ({ page }) => {
  await mockApi(page);
  const posted: any[] = [];
  await page.route("**/api/schema/jobs", async (r) => {
    posted.push(r.request().postDataJSON());
    await r.fulfill({ json: { job_id: "j1", graph: shop, warnings: [] } });
  });
  await open(page, "e2e=1&tier=low");
  expect(posted[0]).toMatchObject({ use_default: true });

  await page.getByRole("button", { name: "Schema" }).click();
  await page.getByLabel("DDL").fill(ddl);
  await page.getByRole("button", { name: "Build web" }).click();
  await expect(page.getByRole("status", { name: "Saved database" })).toContainText("Saved in this browser");
  expect(posted.at(-1).ddl).toBe(ddl);
  expect(await page.evaluate(() => localStorage.getItem("cosmos.rememberDb"))).toBeNull();

  posted.length = 0;
  await page.reload();
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0);
  await expect.poll(() => posted.length).toBeGreaterThan(0);
  expect(posted[0].ddl).toBe(ddl); // nothing was pasted this time

  await page.getByRole("button", { name: "Schema" }).click();
  await page.getByRole("button", { name: "Forget it" }).click();
  await expect(page.getByRole("status", { name: "Saved database" })).toHaveCount(0);
  posted.length = 0;
  await page.reload();
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0);
  await expect.poll(() => posted.length).toBeGreaterThan(0);
  expect(posted[0]).toMatchObject({ use_default: true });
});

test("a saved use case brings back the wish and the settings after a reload", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Describe the result you expect").fill("every order with its customer");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Star size").fill("1.9");
  await page.getByRole("tab", { name: "Use cases" }).click();
  await page.getByLabel("Name").fill("Orders view");
  await page.getByRole("button", { name: "Save current as use case" }).click();
  await expect(page.getByRole("list", { name: "Saved use cases" })).toContainText("Orders view");

  await page.reload();
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByLabel("Describe the result you expect")).toHaveValue("every order with its customer");
});
