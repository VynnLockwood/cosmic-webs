import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { mockApi, open } from "./helpers";

// Baselines are recorded with the JS layout stub (positions differ from the Rust layout), so these run in stub mode only.
test.skip(!!process.env.WASM_REAL, "visual baselines use the stub layout");
test.use({ viewport: { width: 960, height: 600 } });

const T = "public.orders";
const set = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => (window as any).__cosmos.setStore(p), patch);

async function ready(page: Page, qs = "e2e=1&tier=low") {
  await mockApi(page);
  await open(page, qs);
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  await page.waitForTimeout(700);
}
const shot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled" });

test("default", async ({ page }) => {
  await ready(page);
  await shot(page, "default");
});

test("hover", async ({ page }) => {
  await ready(page);
  await set(page, { hoveredTable: T });
  await page.waitForTimeout(400);
  await shot(page, "hover");
});

test("selected", async ({ page }) => {
  await ready(page);
  await set(page, { selectedTable: T });
  await page.waitForTimeout(400);
  await shot(page, "selected");
});

test("search_path", async ({ page }) => {
  await ready(page);
  const dots: Record<string, string> = {};
  for (const n of ["users", "orders", "order_items", "products", "inventory"]) dots[`public.${n}`] = n === "products" || n === "users" ? "required" : "path";
  await set(page, { dotOverrides: dots, linkOverrides: { fk_orders_user: "path" } });
  await page.waitForTimeout(400);
  await shot(page, "search_path");
});

test("flags", async ({ page }) => {
  await ready(page);
  await set(page, { dotOverrides: { "public.coupons": "flagged", "public.tags": "flagged" } });
  await page.waitForTimeout(400);
  await shot(page, "flags");
});

test("reduced_motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await shot(page, "reduced_motion");
});

// WCAG 2.1 AA: panel text (#E6E9FF) over the glass panel, at several nebula orientations.
test("panel_contrast", async ({ page }) => {
  await ready(page, "e2e=1&tier=high");
  await page.getByRole("button", { name: "Schema" }).click();
  await page.waitForTimeout(500);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const colors = { text: lum(0xe6, 0xe9, 0xff), muted: lum(0xa3, 0xaa, 0xd6) };
  let worst = Infinity;
  for (const az of [0, 60, 120, 180, 240, 300]) {
    await page.evaluate((a) => (window as any).__cosmos.orbitTo(a), az);
    await page.waitForTimeout(400);
    const box = (await page.locator(".drawer").boundingBox())!;
    // the empty lower part of the glass panel: pure background, no controls or text
    const band = { x: box.x + 8, y: box.y + box.height - 70, width: box.width - 16, height: 60 };
    const png = PNG.sync.read(await page.screenshot({ clip: band }));
    const ls: number[] = [];
    for (let i = 0; i < png.data.length; i += 4) ls.push(lum(png.data[i], png.data[i + 1], png.data[i + 2]));
    ls.sort((a, b) => a - b);
    const bg = ls[Math.floor(ls.length * 0.99)]; // brightest 1%: ignore single star pixels
    for (const l of Object.values(colors)) worst = Math.min(worst, (l + 0.05) / (bg + 0.05));
  }
  expect(worst).toBeGreaterThanOrEqual(4.5);
});
