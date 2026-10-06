import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react'
import { hasContent } from '../internal/hasContent'
import { mergeRefs } from '../internal/mergeRefs'
import './Checkbox.css'

export type CheckboxProps = Omit<
  ComponentPropsWithRef<'input'>,
  'type' | 'children'
> & {
  /** Required: the text of the real `<label>` that wraps the input. */
  label: ReactNode
  /** Helper text outside the label, linked with aria-describedby. */
  description?: ReactNode
  /**
   * The mixed state. `indeterminate` is a DOM property, not an attribute, so
   * it is set from this prop after every render. The browser clears it when
   * the user clicks, so update the prop in `onChange` to keep it in sync.
   */
  indeterminate?: boolean
}

/**
 * A native `<input type="checkbox">` inside a real `<label>`. The box is drawn
 * by the browser with `accent-color` from a token (the unchecked border and
 * the check mark are the browser's own and not controllable here).
 */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  id,
  className,
  ref,
  'aria-describedby': describedByProp,
  ...inputProps
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const hasDescription = hasContent(description)

  const innerRef = useRef<HTMLInputElement>(null)
  const mergedRef = useMemo(() => mergeRefs(ref, innerRef), [ref])

  // Runs after every render so the prop stays authoritative even after the
  // browser cleared the property on a click.
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate
  })

  const describedBy = [
    describedByProp,
    hasDescription ? descriptionId : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="dts-checkbox">
      <label className="dts-checkbox__label">
        <input
          {...inputProps}
          ref={mergedRef}
          id={inputId}
          type="checkbox"
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={
            className
              ? `dts-checkbox__input ${className}`
              : 'dts-checkbox__input'
          }
        />
        <span className="dts-checkbox__text">{label}</span>
      </label>
      {hasDescription ? (
        <p id={descriptionId} className="dts-checkbox__description">
          {description}
        </p>
      ) : null}
    </div>
  )
}
