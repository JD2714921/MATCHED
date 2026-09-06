import { defineConfig, devices } from "@playwright/test";

// Chromium is preinstalled in this environment. `playwright install` must NOT be
// run — instead point Playwright at the existing binary. Without this every
// browser test fails to launch.
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      // The container runs as root, where Chromium's sandbox cannot start.
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run build && E2E=1 npx next start -p ${PORT}`,
    url: BASE_URL,
    // Deliberately false. A stale `next start` left over from a previous run
    // will happily serve an OLD build and produce failures that make no sense
    // against the current source.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      E2E: "1",
      EXCHANGE_PROVIDER: "fixture",
      AI_PROVIDER: "stub",
    },
  },
});
