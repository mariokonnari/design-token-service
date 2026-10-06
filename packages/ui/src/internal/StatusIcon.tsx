export type StatusKind = 'info' | 'success' | 'warning' | 'danger'

const SHAPES: Record<StatusKind, React.ReactNode> = {
  info: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5M10 6h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M6.5 10.5l2.5 2.5 4.5-5" />
    </>
  ),
  warning: (
    <>
      <path d="M10 2.5l8 14H2z" />
      <path d="M10 8v4M10 14.5h.01" />
    </>
  ),
  danger: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M7 7l6 6M13 7l-6 6" />
    </>
  ),
}

/**
 * A decorative inline icon (no external assets). It is hidden from assistive
 * technology: the meaning is always also carried by text, never by the icon or
 * its color alone. Drawn with currentColor, so the stylesheet picks the color.
 */
export function StatusIcon({
  kind,
  className,
}: {
  kind: StatusKind
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[kind]}
    </svg>
  )
}
