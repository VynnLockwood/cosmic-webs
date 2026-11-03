import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const useStub = !!process.env.VITE_USE_STUB || !!process.env.VITEST;
const wasmDir = fileURLToPath(new URL(useStub ? "./src/wasm-stub" : "./src/wasm", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@wasm": wasmDir } },
  worker: { format: "es" },
  build: {
    chunkSizeWarningLimit: 1500, // three.js alone is ~1.2 MB minified; it loads lazily, in parallel with the schema
    rollupOptions: {
      output: {
        // vendor code changes rarely: keep it in its own long-cacheable files
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(three|postprocessing)\//.test(id)) return "three";
          if (/node_modules\/@react-three\//.test(id)) return "r3f";
          return undefined;
        },
      },
    },
  },
  server: { host: true, port: 5173, fs: { allow: ["..", "../samples"] }, proxy: { "/api": "http://localhost:8000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
