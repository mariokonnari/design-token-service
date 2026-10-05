import type { ButtonHTMLAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/** Placeholder component. Real styling will come from semantic CSS custom properties. */
export function Button({ type = 'button', ...props }: ButtonProps) {
  return <button type={type} {...props} />
}
