import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { afterEach, expect } from 'vitest'

// jest-axe is written for Jest; its matcher only needs `expect.extend`, so it
// works under Vitest. Types: test/support/jest-axe.d.ts and vitest-axe-matcher.d.ts.
expect.extend(toHaveNoViolations)

// Every test starts from a clean DOM, clean storage and a default title.
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.title = ''
})
