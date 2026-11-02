import { expect, test, type Page } from "@playwright/test";
import { mockApi, open } from "./helpers";

const T = "public.orders";
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pose = (page: Page) => page.evaluate(() => (window as any).__cosmos.cameraPose());
const dotWorld = (page: Page, name: string) => page.evaluate((n: string) => (window as any).__cosmos.dotWorld(n), name);
const state = (page: Page) => page.evaluate(() => (window as any).__cosmos.state());

async function clickDot(page: Page, name: string) {
  await page.waitForFunction(() => (window as any).__cosmos.state?.().layoutSettled, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  const { x, y } = await page.evaluate((n: string) => (window as any).__cosmos.dotScreen(n), name);
  await page.mouse.move(x, y);
  await page.waitForTimeout(300); // pointer-over before click, like a real user
  await page.mouse.click(x, y);
}

const panelOpen = (page: Page, timeout = 20_000) => page.waitForFunction((n) => (window as any).__cosmos.state().panelTable === n, T, { timeout });

test("click_dot_flies_to_3r_and_opens_panel_state", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await clickDot(page, T);
  await panelOpen(page);
  const p = await pose(page);
  const d = await dotWorld(page, T);
  const r = await page.evaluate((n: string) => (window as any).__cosmos.dotRadius(n), T);
  expect(Math.abs(dist(p.pos, d) - 3 * r)).toBeLessThan(0.3);
  expect(dist(p.target, d)).toBeLessThan(0.5);
});

test("esc_returns_to_previous_pose", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  const before = await pose(page);
  await clickDot(page, T);
  await panelOpen(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as any).__cosmos.state().selectedTable === null);
  await expect
    .poll(async () => dist((await pose(page)).pos, before.pos), { timeout: 20_000 })
    .toBeLessThan(2);
});

test("reduced_motion_move_completes_fast", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await clickDot(page, T);
  const t0 = Date.now();
  await panelOpen(page, 5000);
  expect(Date.now() - t0).toBeLessThan(2500); // 300 ms move, generous slack for slow software GL
  const p = await pose(page);
  expect(dist(p.target, await dotWorld(page, T))).toBeLessThan(0.5);
});
