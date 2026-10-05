import type { ComponentPropsWithRef } from 'react'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * A native button. `variant` and `size` become `data-*` attributes that the
 * stylesheet (Button.css) keys on; `ref` is a regular prop in React 19.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={className ? `dts-button ${className}` : 'dts-button'}
      data-variant={variant}
      data-size={size}
    />
  )
}
