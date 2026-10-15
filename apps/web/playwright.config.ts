import { defineConfig, devices } from '@playwright/test'
import { e2eDatabaseUrl } from './e2e/support/database'
import { API_ORIGIN, API_PORT, WEB_ORIGIN, WEB_PORT } from './e2e/support/ports'

const isCI = Boolean(process.env['CI'])

// The workers (and the Viewer helper) must use the SAME database as the API below.
process.env['E2E_DATABASE_URL'] = e2eDatabaseUrl()

/**
 * Real-stack browser tests (ADR 0016): Chromium -> the BUILT web bundle served by
 * `vite preview` (with the same `/api` proxy as development) -> the REAL API
 * (apps/api/test/support/e2eServer.ts, test-only entry) -> a real Postgres.
 *
 * - retries: 0. A flaky accessibility or session test is a bug to find, not hide
 *   (ADR 0010). workers: 2, set explicitly: the default on this 4-core machine
 *   flaked the Storybook suite (see ADR 0010); two workers share one API and one
 *   database, which is safe because every test creates its own user and slugs.
 * - reuseExistingServer: false, always. The suite never attaches to a server that
 *   was already running (a developer's API could be writing to a dev database).
 * - No sleeps anywhere: Playwright's auto-waiting assertions only.
 * - `pnpm test:e2e` refuses to start on a stale `dist/` (scripts/assertFreshDist.ts).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: 2,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The API first: it prepares the database, so the page never races it.
      command: 'pnpm exec tsx test/support/e2eServer.ts',
      cwd: '../api',
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        DATABASE_URL: e2eDatabaseUrl(),
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_ORIGIN: WEB_ORIGIN,
      },
    },
    {
      // The BUILT bundle, with the same /api proxy the dev server uses.
      command: `pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...(process.env as Record<string, string>),
        API_PROXY_TARGET: API_ORIGIN,
      },
    },
  ],
})
