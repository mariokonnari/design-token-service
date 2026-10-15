import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { StatusIcon } from '../internal/StatusIcon'
import { hasContent } from '../internal/hasContent'
import '../visually-hidden.css'
import './Select.css'

export type SelectProps = ComponentPropsWithRef<'select'> & {
  /** Required. The accessible name of the select. */
  label: ReactNode
  /** Helper text, linked to the select with aria-describedby. */
  description?: ReactNode
  /** Error message. While set, the select gets aria-invalid and the message is linked with aria-describedby. */
  error?: ReactNode
  /**
   * Visible hint shown (aria-hidden) next to the label when `required`.
   * Built-in text is English only; the library ships no translations, so pass
   * your own string. Default: "(required)".
   */
  requiredHint?: string
  /**
   * Visually hidden text read before the error message so it is never conveyed
   * by color or icon alone. English default "Error: "; pass your own for
   * other languages.
   */
  errorPrefix?: string
}

/**
 * A native `<select>` with a real label. The options are plain `<option>`
 * children; the browser draws the arrow and the popup (no custom dropdown, so
 * keyboard, screen reader and forced-colors behavior stay the platform's).
 *
 * Like TextField: an error that appears after a submit is linked to the select
 * but is NOT announced by itself. Move focus or use an Alert / live region.
 */
export function Select({
  label,
  description,
  error,
  requiredHint = '(required)',
  errorPrefix = 'Error: ',
  id,
  required,
  className,
  children,
  'aria-describedby': describedByProp,
  'aria-invalid': ariaInvalidProp,
  ...selectProps
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const descriptionId = `${selectId}-description`
  const errorId = `${selectId}-error`

  const hasDescription = hasContent(description)
  const hasError = hasContent(error)

  const describedBy = [
    describedByProp,
    hasDescription ? descriptionId : undefined,
    hasError ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="dts-select">
      <label className="dts-select__label" htmlFor={selectId}>
        {label}
        {required ? (
          <>
            {' '}
            {/* The native `required` attribute already announces it: the visible hint is aria-hidden. */}
            <span className="dts-select__required" aria-hidden="true">
              {requiredHint}
            </span>
          </>
        ) : null}
      </label>
      {hasDescription ? (
        <p id={descriptionId} className="dts-select__description">
          {description}
        </p>
      ) : null}
      <select
        {...selectProps}
        id={selectId}
        required={required}
        aria-invalid={hasError ? true : ariaInvalidProp}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={
          className ? `dts-select__control ${className}` : 'dts-select__control'
        }
      >
        {children}
      </select>
      {hasError ? (
        <p id={errorId} className="dts-select__error">
          <span className="dts-visually-hidden">{errorPrefix}</span>
          <StatusIcon kind="danger" className="dts-select__icon" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
