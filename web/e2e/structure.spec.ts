import { expect, test } from "@playwright/test";
import { mockApi, open, shop } from "./helpers";

const pk = { schema: "public", table: "public.orders", name: "orders_pkey", columns: ["id"], unique: true, primary: true, definition: "" };
const newFk = { id: "fk_reviews_rating", from: { table: "public.reviews", columns: ["rating"] }, to: { table: "public.orders", columns: ["id"] } };

test("adding a link updates the web without moving the camera", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/structure", (r) => r.fulfill({ json: { graph: shop, indexes: [pk] } }));
  await page.route("**/api/structure/apply", (r) =>
    r.fulfill({ json: { graph: { ...shop, fks: [...shop.fks, newFk] }, indexes: [pk], executed: ['ALTER TABLE "public"."reviews" ADD CONSTRAINT "fk_reviews_rating" FOREIGN KEY ("rating") REFERENCES "public"."orders" ("id") NOT VALID'] } }),
  );
  await open(page, "e2e=1&tier=low");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  const before = await page.evaluate(() => (window as any).__cosmos.cameraPose());
  await page.getByRole("button", { name: "Structure" }).click();
  await expect(page.getByRole("heading", { name: "Structure lab" })).toBeVisible();
  await page.getByText("Foreign keys", { exact: true }).click(); // the card is collapsed until opened
  await page.getByLabel("FK from table").selectOption("public.reviews");
  await page.getByLabel("FK from column").selectOption("rating");
  await page.getByLabel("FK to table").selectOption("public.orders");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.waitForFunction((n) => (window as any).__cosmos.linkCount === n, shop.fks.length + 1);
  await expect(page.getByLabel("Executed SQL")).toContainText("ADD CONSTRAINT");
  expect(await page.evaluate(() => (window as any).__cosmos.dotCount)).toBe(25);
  const after = await page.evaluate(() => (window as any).__cosmos.cameraPose());
  expect(Math.hypot(...after.pos.map((v: number, i: number) => v - before.pos[i]))).toBeLessThan(1);
});

test("the lab refuses to run on a live source", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/structure", (r) => r.fulfill({ json: { graph: shop, indexes: [pk] } }));
  await open(page, "e2e=1&tier=low");
  await page.evaluate(() => (window as any).__cosmos.setStore({ sourceMode: "live" }));
  await page.getByRole("button", { name: "Structure" }).click();
  await expect(page.getByText(/never on a live database/)).toBeVisible();
});
