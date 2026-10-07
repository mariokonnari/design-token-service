import { act } from '@testing-library/react'

/**
 * jsdom (30.x) has the HTMLDialogElement constructor and the `open` attribute but
 * NO showModal(), show() or close(). This is a minimal test double so the unit
 * tests can check props, ARIA wiring and state syncing.
 *
 * What it does NOT simulate (covered only by the real-browser suite, e2e/dialog.spec.ts):
 * the top layer, the inert background, the focus trap and focus restoration,
 * ::backdrop, the Esc key, and any layout.
 */
export interface DialogDouble {
  /** Every call the component made, in order. */
  calls: string[]
  /** What the browser does on Esc: closes the dialog (and fires `close` later). */
  pressEscape: (dialog: HTMLDialogElement) => void
  /** Lets queued `close` events (a browser task) run inside act(). */
  flush: () => Promise<void>
  restore: () => void
}

type Method = 'showModal' | 'show' | 'close'

export function installDialogDouble(): DialogDouble {
  const proto = HTMLDialogElement.prototype
  const originals = new Map<Method, PropertyDescriptor | undefined>()
  const calls: string[] = []
  const modal = new WeakSet<HTMLDialogElement>()

  const define = (name: Method, value: (this: HTMLDialogElement) => void) => {
    originals.set(name, Object.getOwnPropertyDescriptor(proto, name))
    Object.defineProperty(proto, name, { configurable: true, value })
  }

  function close(this: HTMLDialogElement) {
    calls.push('close')
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    modal.delete(this)
    // Like a browser: the `close` event is queued, not synchronous.
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }

  define('showModal', function (this: HTMLDialogElement) {
    calls.push('showModal')
    if (this.hasAttribute('open')) {
      if (modal.has(this)) return
      throw new DOMException(
        'Already open as a non-modal dialog',
        'InvalidStateError',
      )
    }
    this.setAttribute('open', '')
    modal.add(this)
  })
  define('show', function (this: HTMLDialogElement) {
    calls.push('show')
    this.setAttribute('open', '')
  })
  define('close', close)

  return {
    calls,
    pressEscape: (dialog) => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
      close.call(dialog)
    },
    flush: () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }),
    restore: () => {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(proto, name, descriptor)
        else Reflect.deleteProperty(proto, name)
      }
    },
  }
}
