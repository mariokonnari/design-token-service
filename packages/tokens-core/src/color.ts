/** sRGB components, each in [0, 1]: red, green, blue. */
export type Rgb = [number, number, number]

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Parses strict `#rrggbb` (case-insensitive). Anything else is `undefined`; never throws. */
export function parseHex(hex: string): Rgb | undefined {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) return undefined
  const channel = (start: number) =>
    Number.parseInt(hex.slice(start, start + 2), 16) / 255
  return [channel(1), channel(3), channel(5)]
}

/** Writes lowercase `#rrggbb` with 8-bit rounding. Components are clamped to [0, 1]; NaN is 0. */
export function toHex(components: readonly [number, number, number]): string {
  const byte = (component: number) =>
    Math.round(clamp01(component) * 255)
      .toString(16)
      .padStart(2, '0')
  const [red, green, blue] = components
  return `#${byte(red)}${byte(green)}${byte(blue)}`
}

/** sRGB channel to linear light, per WCAG 2.2 (threshold 0.04045). */
function linearize(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/** WCAG 2.2 relative luminance of an opaque sRGB color. Inputs are clamped to [0, 1]. */
export function relativeLuminance(
  components: readonly [number, number, number],
): number {
  const [red, green, blue] = components
  return (
    0.2126 * linearize(clamp01(red)) +
    0.7152 * linearize(clamp01(green)) +
    0.0722 * linearize(clamp01(blue))
  )
}

/**
 * WCAG 2.x contrast ratio, `(L1 + 0.05) / (L2 + 0.05)` with L1 the lighter
 * color. Both colors must be opaque (see {@link flattenAlpha}). Symmetric and
 * always in [1, 21].
 */
export function contrastRatio(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Composites a translucent color over an opaque background, per channel in
 * gamma-encoded sRGB (`fg * a + bg * (1 - a)`), which is how contrast checkers
 * conventionally treat transparency. Alpha is clamped to [0, 1]; a missing or
 * non-finite alpha means opaque. Returns a new array.
 */
export function flattenAlpha(
  foreground: { components: readonly [number, number, number]; alpha?: number },
  background: readonly [number, number, number],
): Rgb {
  const raw = foreground.alpha
  const alpha = raw === undefined || !Number.isFinite(raw) ? 1 : clamp01(raw)
  const [fr, fg, fb] = foreground.components
  const [br, bg, bb] = background
  return [
    fr * alpha + br * (1 - alpha),
    fg * alpha + bg * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  ]
}
