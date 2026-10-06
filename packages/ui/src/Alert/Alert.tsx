import type { ComponentPropsWithRef, ReactNode } from 'react'
import { StatusIcon, type StatusKind } from '../internal/StatusIcon'
import '../visually-hidden.css'
import './Alert.css'

export type AlertVariant = StatusKind

/**
 * Built-in prefixes, English only. The library ships no translations: pass
 * `labelPrefix` to use your own language.
 */
const DEFAULT_PREFIX: Record<AlertVariant, string> = {
  info: 'Information: ',
  success: 'Success: ',
  warning: 'Warning: ',
  danger: 'Error: ',
}

export type AlertProps = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  variant?: AlertVariant
  /** Optional title shown above the content. */
  title?: ReactNode
  /**
   * Visually hidden text read before the content so meaning never depends on
   * color or the icon. Defaults to an English word per variant ("Error: " for
   * danger); pass your own for other languages, or '' to omit it.
   */
  labelPrefix?: string
}

/**
 * A message box with a role and a hidden text prefix per variant.
 *
 * Roles: `danger` is `role="alert"` (assertive), the others are
 * `role="status"` (polite).
 *
 * LIVE-REGION LIMITATION: both roles make the element a live region, but
 * assistive technology announces CHANGES to a live region after it has been
 * mounted, and may not announce content that is already present on first
 * render. For reliable announcements, mount the Alert (empty or not) before
 * the event and then add the content, or mount it in response to the event;
 * don't rely on an Alert that is rendered with its text on initial page load.
 * Support differs between screen readers, and a `role="alert"` that is always
 * on screen can be noisy, so use `danger` for things that need attention now.
 */
export function Alert({
  variant = 'info',
  title,
  labelPrefix,
  role,
  className,
  children,
  ...props
}: AlertProps) {
  const prefix = labelPrefix ?? DEFAULT_PREFIX[variant]
  const hiddenPrefix =
    prefix === '' ? null : <span className="dts-visually-hidden">{prefix}</span>
  const hasTitle = title !== undefined && title !== null && title !== false

  return (
    <div
      {...props}
      role={role ?? (variant === 'danger' ? 'alert' : 'status')}
      className={className ? `dts-alert ${className}` : 'dts-alert'}
      data-variant={variant}
    >
      <span className="dts-alert__icon" aria-hidden="true">
        <StatusIcon kind={variant} />
      </span>
      <div className="dts-alert__body">
        {hasTitle ? (
          <p className="dts-alert__title">
            {hiddenPrefix}
            {title}
          </p>
        ) : null}
        <div className="dts-alert__content">
          {hasTitle ? null : hiddenPrefix}
          {children}
        </div>
      </div>
    </div>
  )
}
