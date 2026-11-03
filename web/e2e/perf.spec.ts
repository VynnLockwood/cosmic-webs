import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi, open } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const big = JSON.parse(fs.readFileSync(path.resolve(here, "../../samples/synthetic500.graph.json"), "utf8"));

test("five_hundred_tables_load_and_render_without_errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockApi(page, big);
  await open(page, "e2e=1&tier=low");
  expect(await page.evaluate(() => (window as any).__cosmos.dotCount)).toBe(500);
  expect(await page.evaluate(() => (window as any).__cosmos.linkCount)).toBe(big.fks.length);
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

// The 50 fps / 3 s targets are for a real (integrated or better) GPU and the Rust WASM layout.
test("five_hundred_tables_hit_fps_and_settle_targets", async ({ page }) => {
  test.skip(!process.env.PERF, "set PERF=1 on a machine with a GPU (and WASM_REAL=1 for the Rust layout)");
  await mockApi(page, big);
  const t0 = Date.now();
  await open(page, "e2e=1");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  expect(Date.now() - t0).toBeLessThan(3000 + 5000); // 3 s layout budget + page/WASM load slack
  await page.waitForTimeout(5000);
  expect(await page.evaluate(() => (window as any).__cosmos.fps())).toBeGreaterThanOrEqual(50);
});
