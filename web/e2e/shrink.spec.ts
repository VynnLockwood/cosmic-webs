import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi, open, shop } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const big = JSON.parse(fs.readFileSync(path.resolve(here, "../../samples/synthetic500.graph.json"), "utf8"));

// Uploading a smaller schema after a big one used to crash the whole 3D view (labels still pointed at table #400 of 25).
test("loading a smaller schema after a big one keeps the scene alive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockApi(page, big);
  await open(page, "e2e=1&tier=low");
  await page.waitForTimeout(1500); // long enough for the nearest-label list to pick far-away tables
  await page.evaluate((g) => (window as any).__cosmos.setStore({ graph: g }), shop);
  await page.waitForFunction(() => (window as any).__cosmos.dotCount === 25);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
  expect((await page.evaluate(() => (window as any).__cosmos.gpu())).geometries).toBeGreaterThan(0); // still drawing
});
