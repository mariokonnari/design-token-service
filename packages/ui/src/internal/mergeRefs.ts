import type { Ref, RefCallback } from 'react'

/**
 * Combines several refs (callback or object) into one callback ref. Supports
 * React 19 cleanup functions returned from callback refs.
 */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups: (() => void)[] = []
    for (const ref of refs) {
      if (typeof ref === 'function') {
        const cleanup = ref(node)
        cleanups.push(
          typeof cleanup === 'function'
            ? cleanup
            : () => {
                ref(null)
              },
        )
      } else if (ref !== null && ref !== undefined) {
        ref.current = node
        cleanups.push(() => {
          ref.current = null
        })
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }
}
