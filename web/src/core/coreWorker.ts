import * as Comlink from "comlink";
import init, * as wasm from "@wasm/cosmos_core.js";
import { createCoreApi } from "./coreApi";

await init();
Comlink.expose(createCoreApi(wasm));
