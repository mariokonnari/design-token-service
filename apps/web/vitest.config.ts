import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    // e2e/ holds Playwright specs (real browser + real API), run by `pnpm test:e2e`.
    exclude: [...configDefaults.exclude, 'dist/**', 'e2e/**'],
  },
})
