/**
 * The database you imported (the file text), kept in this browser's IndexedDB so you do not paste it again.
 * IndexedDB has room for big dumps; localStorage stops at about 5 MB. Every call swallows errors:
 * with no IndexedDB (private mode, old browser) the app works as before and just forgets at reload.
 */
export interface SavedDb { ddl: string; useDump: boolean; savedAt: number }
export interface SavedDbInfo { bytes: number; savedAt: number }

const NAME = "cosmos";
const STORE = "kv";
const KEY = "database";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const sizeOf = (ddl: string) => new Blob([ddl]).size;

/** true when the text was stored */
export async function saveDatabase(ddl: string, useDump: boolean): Promise<boolean> {
  try {
    await tx("readwrite", (s) => s.put({ ddl, useDump, savedAt: Date.now() } satisfies SavedDb, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadDatabase(): Promise<SavedDb | null> {
  try {
    const v = await tx<any>("readonly", (s) => s.get(KEY));
    return typeof v?.ddl === "string" && v.ddl.trim() !== "" ? { ddl: v.ddl, useDump: v.useDump !== false, savedAt: Number(v.savedAt) || 0 } : null;
  } catch {
    return null;
  }
}

export async function clearDatabase(): Promise<void> {
  try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* nothing to forget */ }
}
