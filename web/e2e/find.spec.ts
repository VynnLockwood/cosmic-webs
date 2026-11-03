import { expect, test } from "@playwright/test";
import { mockApi, open } from "./helpers";

test("ctrl_k_finds_a_table_by_name_and_flies_to_it", async ({ page }) => {
  await mockApi(page);
  await open(page, "e2e=1&tier=low");
  await page.waitForFunction(() => (window as any).__cosmos.state().layoutSettled, null, { timeout: 30_000 });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Find table" })).toBeFocused();
  await page.keyboard.type("ship");
  const options = page.getByRole("listbox", { name: "Find table options" }).getByRole("option");
  await expect(options.first()).toContainText("shipments");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window as any).__cosmos.state().selectedTable === "public.shipments", null, { timeout: 15_000 });
});
