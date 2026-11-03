import * as Comlink from "comlink";
import type { CoreApi } from "./coreApi";

let core: CoreApi | null = null;

/** The WASM core, running in a Web Worker. Tests inject a fake with setCore(). */
export function getCore(): CoreApi {
  if (!core) {
    const worker = new Worker(new URL("./coreWorker.ts", import.meta.url), { type: "module" });
    core = Comlink.wrap<CoreApi>(worker) as unknown as CoreApi;
  }
  return core;
}
export function setCore(c: CoreApi | null) {
  core = c;
}
