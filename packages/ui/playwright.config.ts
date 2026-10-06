import { defineConfig, devices } from '@playwright/test'

const PORT = 6007 // not 6006, so a running `storybook dev` does not clash
const isCI = Boolean(process.env['CI'])

/**
 * Real-browser tests against the BUILT Storybook (ADR 0010). Run
 * `pnpm --filter @dts/ui build-storybook` first (or use `test:e2e:build`).
 * retries is 0 on purpose: a flaky accessibility test is a bug to fix, not to retry.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --dev: no cached file list, so a rebuilt storybook-static is served as is.
    command: `sirv storybook-static --dev --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !isCI,
  },
})
