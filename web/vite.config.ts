import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const useStub = !!process.env.VITE_USE_STUB || !!process.env.VITEST;
const wasmDir = fileURLToPath(new URL(useStub ? "./src/wasm-stub" : "./src/wasm", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@wasm": wasmDir } },
  worker: { format: "es" },
  server: { host: true, port: 5173, fs: { allow: ["..", "../samples"] }, proxy: { "/api": "http://localhost:8000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
