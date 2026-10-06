import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // e2e/ holds Playwright specs (real browser), run by `pnpm test:e2e`.
    exclude: [...configDefaults.exclude, 'storybook-static/**', 'e2e/**'],
  },
})
