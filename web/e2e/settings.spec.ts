import { expect, test } from "@playwright/test";
import { mockApi, open } from "./helpers";

test("look settings are saved in the browser and survive a reload", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.getByRole("button", { name: "Settings" }).click();
  const size = page.getByLabel("Star size");
  await size.fill("1.8");
  await page.getByLabel("Spin sensitivity").fill("2.2");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cosmos.visual")!))).toMatchObject({ starSize: 1.8, spin: 2.2 });
  await page.reload();
  await page.waitForFunction(() => (window as any).__cosmos?.dotCount > 0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Star size")).toHaveValue("1.8");
  await expect(page.getByLabel("Spin sensitivity")).toHaveValue("2.2");
  await page.getByRole("button", { name: "Reset look" }).click();
  await expect(page.getByLabel("Star size")).toHaveValue("1");
});
