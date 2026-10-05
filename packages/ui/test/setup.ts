import { cleanup } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { afterEach, expect } from 'vitest'

// jest-axe is written for Jest; its matcher only needs `expect.extend`, so it
// works under Vitest. Types are declared in test/support/jest-axe.d.ts and vitest-axe-matcher.d.ts.
expect.extend(toHaveNoViolations)

afterEach(cleanup)
