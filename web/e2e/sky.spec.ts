import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import { mockApi, open } from "./helpers";

const hash = async (page: import("@playwright/test").Page) => crypto.createHash("sha1").update(await page.locator("canvas").screenshot()).digest("hex");

test("sky_changes_after_90deg_orbit_and_is_identical_after_return", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&sky=only");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 }); // the camera is framed once the layout settles
  const orbit = async (deg: number) => {
    await page.evaluate((d) => (window as any).__cosmos.orbitTo(d), deg);
    await page.waitForTimeout(500);
  };
  await orbit(0);
  const a = await hash(page);
  await orbit(90);
  const b = await hash(page);
  await orbit(0);
  const c = await hash(page);
  expect(b).not.toBe(a);
  expect(c).toBe(a);
});
