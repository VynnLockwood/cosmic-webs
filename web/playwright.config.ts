import { defineConfig } from "@playwright/test";

// Local runs build with the JS wasm stub; CI/Docker runs set WASM_REAL=1 after `npm run wasm`.
const build = process.env.WASM_REAL ? "npx vite build" : "VITE_USE_STUB=1 npx vite build";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] },
  },
  webServer: { command: `${build} && npx vite preview --port 4173 --strictPort`, url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
