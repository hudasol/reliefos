import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// End-to-end tests drive the built application served by the real server (embedded PGlite in a
// throwaway directory). Locally they use the installed Microsoft Edge; set E2E_CHANNEL='' to use the
// Playwright-bundled Chromium (`npx playwright install chromium`).
const PORT = 8091;
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : '');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dist/server/server/index.js',
    url: `http://localhost:${PORT}/api/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      PGLITE_DATA_DIR: path.join(os.tmpdir(), `reliefos-e2e-${Date.now()}`),
      LOG_LEVEL: 'warn',
    },
  },
});
