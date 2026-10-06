import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { StatusIcon } from '../internal/StatusIcon'
import { hasContent } from '../internal/hasContent'
import '../visually-hidden.css'
import './TextField.css'

export type TextFieldProps = Omit<
  ComponentPropsWithRef<'input'>,
  'children'
> & {
  /** Required. A placeholder is not a label: it disappears while typing and is not a reliable accessible name. */
  label: ReactNode
  /** Helper text, linked to the input with aria-describedby. */
  description?: ReactNode
  /** Error message. While set, the input gets aria-invalid and the message is linked with aria-describedby. */
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
 * A text input with a real label.
 *
 * Note for consumers: an error that appears after a submit is linked to the
 * input but is NOT announced by itself. Move focus to the field or to an error
 * summary, or use an Alert / live region, when you want it announced.
 */
export function TextField({
  label,
  description,
  error,
  requiredHint = '(required)',
  errorPrefix = 'Error: ',
  id,
  type = 'text',
  required,
  className,
  'aria-describedby': describedByProp,
  'aria-invalid': ariaInvalidProp,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`

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
    <div className="dts-textfield">
      <label className="dts-textfield__label" htmlFor={inputId}>
        {label}
        {required ? (
          <>
            {' '}
            {/*
              The native `required` attribute already tells assistive
              technology the field is required, so this visible hint is
              aria-hidden to avoid announcing it twice.
            */}
            <span className="dts-textfield__required" aria-hidden="true">
              {requiredHint}
            </span>
          </>
        ) : null}
      </label>
      {hasDescription ? (
        <p id={descriptionId} className="dts-textfield__description">
          {description}
        </p>
      ) : null}
      <input
        {...inputProps}
        id={inputId}
        type={type}
        required={required}
        aria-invalid={hasError ? true : ariaInvalidProp}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={
          className
            ? `dts-textfield__input ${className}`
            : 'dts-textfield__input'
        }
      />
      {hasError ? (
        <p id={errorId} className="dts-textfield__error">
          <span className="dts-visually-hidden">{errorPrefix}</span>
          <StatusIcon kind="danger" className="dts-textfield__icon" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
