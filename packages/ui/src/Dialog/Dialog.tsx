import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type ComponentPropsWithRef,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { hasContent } from '../internal/hasContent'
import { mergeRefs } from '../internal/mergeRefs'
import './Dialog.css'

/*
 * A modal dialog built on the native <dialog> element and showModal(), so the
 * browser provides the top layer, the inert background, the focus trap, Esc and
 * focus restoration. We do not reimplement them (ADR 0011).
 *
 * Known limitations:
 * - Controlled only. Esc is handled by the browser and is NEVER prevented: the
 *   dialog closes, then onOpenChange(false) is called. A parent that keeps
 *   `open` true afterwards leaves the state out of sync with the element, so
 *   the parent must honor onOpenChange(false).
 * - No scroll lock for the page behind the dialog, no nested dialogs, no
 *   right-to-left handling, no animations, and no portal (the dialog renders
 *   where it is placed, so it inherits the theme from ThemeScope).
 * - The browser decides where focus goes on open: the first focusable element
 *   (the close button).
 * - Chromium may need Esc twice when the dialog was opened without any user
 *   interaction (anti-abuse "close watcher" behaviour).
 * - The page behind is not scroll-locked and background text selection is not
 *   blocked beyond what the browser does for modal dialogs.
 */

export type DialogProps = Omit<
  ComponentPropsWithRef<'dialog'>,
  'open' | 'title' | 'children' | 'onClose'
> & {
  open: boolean
  /** Called with false when the user closes the dialog (Esc, close button, backdrop). */
  onOpenChange: (open: boolean) => void
  /** Required. Rendered as a heading and used as the accessible name. */
  title: ReactNode
  /** The level of the title heading. Default 2. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  description?: ReactNode
  /** The accessible name of the close button. The library ships no translations: pass your own. */
  closeLabel?: string
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdropClick?: boolean
  children?: ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  title,
  headingLevel = 2,
  description,
  closeLabel = 'Close',
  closeOnBackdropClick = true,
  children,
  className,
  ref,
  onPointerDown,
  onPointerUp,
  ...rest
}: DialogProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const hasDescription = hasContent(description)
  const Heading = `h${headingLevel}` as const

  const innerRef = useRef<HTMLDialogElement>(null)
  const mergedRef = useMemo(() => mergeRefs(ref, innerRef), [ref])
  // True only while a press that started on the dialog element itself is in progress.
  const pressStartedOnDialog = useRef(false)

  // open -> showModal(). The cleanup closes the native dialog again: it runs when
  // `open` turns false, on unmount and between StrictMode's double effects.
  useEffect(() => {
    const dialog = innerRef.current
    if (dialog === null || !open) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [open])

  // The native `close` event is asynchronous. It only means "the user closed it"
  // if the prop still says open and the element really is closed at that moment;
  // a close we caused (prop change, unmount, StrictMode re-run) must not be reported.
  function handleClose() {
    const dialog = innerRef.current
    if (open && dialog !== null && !dialog.open) onOpenChange(false)
  }

  return (
    <dialog
      {...rest}
      ref={mergedRef}
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className={className ? `dts-dialog ${className}` : 'dts-dialog'}
      onClose={handleClose}
      // Backdrop click: the dialog element itself has no padding (the inner
      // wrapper has), so an event whose target is the dialog is on the backdrop.
      // Both the press and the release must be there, so a text selection
      // dragged from inside to the backdrop does not close it.
      onPointerDown={(event: PointerEvent<HTMLDialogElement>) => {
        onPointerDown?.(event)
        pressStartedOnDialog.current = event.target === event.currentTarget
      }}
      onPointerUp={(event: PointerEvent<HTMLDialogElement>) => {
        onPointerUp?.(event)
        const both =
          pressStartedOnDialog.current && event.target === event.currentTarget
        pressStartedOnDialog.current = false
        if (both && closeOnBackdropClick) onOpenChange(false)
      }}
    >
      <div className="dts-dialog__inner">
        <div className="dts-dialog__header">
          <Heading id={titleId} className="dts-dialog__title">
            {title}
          </Heading>
          <button
            type="button"
            className="dts-dialog__close"
            aria-label={closeLabel}
            onClick={() => {
              onOpenChange(false)
            }}
          >
            <svg
              className="dts-dialog__close-icon"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3 3l10 10M13 3L3 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {hasDescription ? (
          <p id={descriptionId} className="dts-dialog__description">
            {description}
          </p>
        ) : null}
        <div className="dts-dialog__body">{children}</div>
      </div>
    </dialog>
  )
}
