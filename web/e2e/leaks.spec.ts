import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi, open, shop } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const big = JSON.parse(fs.readFileSync(path.resolve(here, "../../samples/synthetic500.graph.json"), "utf8"));

// Loading schema after schema must not pile up GPU buffers (geometries, textures) or leave old render targets alive.
test("swapping the schema many times does not grow GPU memory", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  const gpu = () => page.evaluate(() => (window as any).__cosmos.gpu() as { geometries: number; textures: number });
  const swap = async (graph: any) => {
    await page.evaluate((g) => (window as any).__cosmos.setStore({ graph: g }), graph);
    await page.waitForFunction((n) => (window as any).__cosmos.dotCount === n, graph.tables.length, { timeout: 30_000 });
    await page.waitForTimeout(250); // let React commit and dispose the previous geometry
  };
  for (let i = 0; i < 3; i++) { await swap(big); await swap(shop); }
  const warm = await gpu();
  for (let i = 0; i < 8; i++) { await swap(big); await swap(shop); }
  const after = await gpu();
  expect(after.geometries).toBeLessThanOrEqual(warm.geometries);
  expect(after.textures).toBeLessThanOrEqual(warm.textures);
  expect(errors).toEqual([]);
});
