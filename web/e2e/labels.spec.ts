import { expect, test } from "@playwright/test";
import { mockApi, open } from "./helpers";

test("table labels are drawn below the UI panels and are shortened", async ({ page }) => {
  const g = { tables: ["a", "b"].map((n, i) => ({ name: `public.${n}CaseCommercialOperationAppointmentLong${i}`, columns: [], row_estimate: 0 })), fks: [] };
  await mockApi(page, g);
  await open(page, "e2e=1&tier=low");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("canvas ~ div div, div > div")].some((d) => d.textContent?.includes("…")));
  const info = await page.evaluate(() => {
    const labels = [...document.querySelectorAll("div")].filter((d) => d.children.length === 0 && d.textContent?.includes("CaseCommercial"));
    const wrappers = labels.map((l) => l.closest("div[style*='z-index']") as HTMLElement | null).filter(Boolean) as HTMLElement[];
    return { count: labels.length, texts: labels.map((l) => l.textContent), z: wrappers.map((w) => Number(w.style.zIndex)) };
  });
  expect(info.count).toBeGreaterThan(0);
  expect(info.texts.every((t) => (t ?? "").length <= 22)).toBe(true);
  expect(info.z.length).toBeGreaterThan(0);
  expect(Math.max(...info.z)).toBeLessThan(5); // the UI layer is z-index 5
});
