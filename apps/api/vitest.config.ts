import { defineConfig } from 'vitest/config'

// The tests use a SEPARATE database whose name ends in `_test` (the compose
// server's `dts_test`, created by the global setup). CI sets DATABASE_URL itself.
// An inherited DATABASE_URL that points elsewhere is refused by the guard in
// test/support/guard.ts, never silently replaced.
process.env['DATABASE_URL'] ||= 'postgresql://dts:dts@localhost:5433/dts_test'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // Serial on purpose: every test file shares ONE database and truncates all
    // tables between tests. Files running in parallel would delete each other's
    // rows mid-test. (Tests within a file already run in order.)
    fileParallelism: false,
  },
})
