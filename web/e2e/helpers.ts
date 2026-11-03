import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const shop = JSON.parse(fs.readFileSync(path.resolve(here, "../../samples/shop.graph.json"), "utf8"));
export const shopSql = fs.readFileSync(path.resolve(here, "../../samples/shop.sql"), "utf8");

/** Mocks the API so browser tests run without Python/Postgres (set E2E_REAL_API=1 to hit a real stack). */
export async function mockApi(page: Page, graph: any = shop) {
  if (process.env.E2E_REAL_API) return;
  await page.route("**/api/schema/default", (r) => r.fulfill({ json: { graph, warnings: [] } }));
  await mockImportJob(page, graph);
  await page.route("**/api/relations/suggest", (r) => r.fulfill({ json: { data_source: "mock", suggestions: [] } }));
  await page.route("**/api/tables/**/values**", (r) => r.fulfill({ json: { values: [], truncated: false } }));
}

export async function open(page: Page, qs = "e2e=1") {
  await page.goto(`/?${qs}`);
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0, null, { timeout: 30_000 });
}

/** A schema import job that is already done: POST returns the parsed graph, polling returns the finished one. */
export async function mockImportJob(page: Page, graph: any) {
  await page.route("**/api/schema/jobs", (r) => r.fulfill({ json: { job_id: "j1", graph, warnings: [] } }));
  await page.route("**/api/jobs/j1", (r) => r.fulfill({ json: { id: "j1", status: "done", stage: "Done", percent: 100, message: "", result: { graph, warnings: [] } } }));
}
