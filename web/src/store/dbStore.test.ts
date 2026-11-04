import { beforeEach, expect, test } from "vitest";
import { clearDatabase, loadDatabase, saveDatabase, sizeOf } from "./dbStore";

beforeEach(async () => { await clearDatabase(); });

test("a saved database comes back whole, even a big one (more than localStorage can hold)", async () => {
  const big = "CREATE TABLE a (id int);\n" + "INSERT INTO a VALUES (1);\n".repeat(400_000); // ~10 MB
  expect(sizeOf(big)).toBeGreaterThan(5 * 1024 * 1024);
  expect(await saveDatabase(big, false)).toBe(true);
  const got = await loadDatabase();
  expect(got?.ddl).toBe(big);
  expect(got?.useDump).toBe(false);
  expect(got!.savedAt).toBeGreaterThan(0);
});

test("saving again replaces; clearing forgets", async () => {
  await saveDatabase("CREATE TABLE one (id int);", true);
  await saveDatabase("CREATE TABLE two (id int);", true);
  expect((await loadDatabase())?.ddl).toBe("CREATE TABLE two (id int);");
  await clearDatabase();
  expect(await loadDatabase()).toBeNull();
});

test("with no IndexedDB nothing throws: save says false, load says nothing", async () => {
  const real = globalThis.indexedDB;
  // @ts-expect-error simulate private mode
  globalThis.indexedDB = undefined;
  try {
    expect(await saveDatabase("x", true)).toBe(false);
    expect(await loadDatabase()).toBeNull();
    await clearDatabase();
  } finally {
    globalThis.indexedDB = real;
  }
});
