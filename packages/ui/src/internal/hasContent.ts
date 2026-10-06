import type { ReactNode } from 'react'

/** Is there something to render? `0` counts; `undefined`, `null`, `false` and `''` do not. */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== ''
}
