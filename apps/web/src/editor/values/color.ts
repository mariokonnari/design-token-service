import { parseHex, toHex, type SrgbColor } from '@dts/tokens-core'
import { bad, cleanInput, good, type Parsed } from './result'

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const ALPHA = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/

/**
 * The colour editor is a hex field plus a separate alpha (0 to 1) field. The
 * COMPONENTS stay the source of truth: when the hex still equals what the original
 * components round to, the original (unrounded) components are kept, so opening and
 * saving a token never moves its colour by rounding. `#rrggbbaa` is not accepted
 * (alpha is its own field) and the `hex` fallback key is never written.
 */
export function parseColor(
  hexText: string,
  alphaText: string,
  original?: SrgbColor,
): Parsed<SrgbColor> {
  const hexInput = cleanInput(hexText)
  if (hexInput === undefined || hexInput === '') {
    return bad('Enter a colour like #2563eb.')
  }
  const short = SHORT_HEX.exec(hexInput)
  const full =
    short === null
      ? hexInput
      : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const components = parseHex(full)
  if (components === undefined) {
    return bad('Enter a colour as # followed by 3 or 6 hexadecimal digits.')
  }

  const alphaInput = cleanInput(alphaText)
  if (alphaInput === undefined)
    return bad('Alpha must be a number from 0 to 1.')
  let alpha: number | undefined
  if (alphaInput !== '') {
    if (!ALPHA.test(alphaInput)) {
      return bad('Alpha must be a number from 0 to 1, like 0.5.')
    }
    const parsed = Number(alphaInput)
    if (parsed < 1) alpha = parsed
  }

  const value: SrgbColor = {
    colorSpace: 'srgb',
    components:
      original !== undefined && toHex(original.components) === toHex(components)
        ? [
            original.components[0],
            original.components[1],
            original.components[2],
          ]
        : components,
  }
  if (alpha !== undefined) value.alpha = alpha
  return good(value)
}

export function formatColor(value: SrgbColor): { hex: string; alpha: string } {
  return {
    hex: toHex(value.components),
    alpha:
      value.alpha === undefined || value.alpha === 1 ? '' : String(value.alpha),
  }
}
