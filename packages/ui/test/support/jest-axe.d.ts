// Minimal local types for jest-axe (it ships none, and @types/jest-axe is stale:
// it pins axe-core 3 and needs @types/jest). This file must stay free of
// top-level imports and exports so that it is an ambient module declaration.

declare module 'jest-axe' {
  export interface AxeViolation {
    id: string
    impact?: string | null
    help: string
    nodes: unknown[]
  }

  export interface AxeResults {
    violations: AxeViolation[]
  }

  export function axe(
    html: Element | string,
    options?: Record<string, unknown>,
  ): Promise<AxeResults>

  export function configureAxe(options?: Record<string, unknown>): typeof axe

  export const toHaveNoViolations: Record<
    'toHaveNoViolations',
    (results: AxeResults) => { pass: boolean; message: () => string }
  >
}
