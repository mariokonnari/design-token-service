import { fontWeightToNumber, type FontWeight } from '@dts/tokens-core'
import { bad, cleanInput, good, type Parsed } from './result'

const NUMERIC = /^\d{1,4}(?:\.\d{1,6})?$/
const NAME = /^[a-z]+(?:-[a-z]+)*$/

/** A number from 1 to 1000, or one of the DTCG weight names (lower case, like `semi-bold`). */
export function parseFontWeight(text: string): Parsed<FontWeight> {
  const input = cleanInput(text)
  if (input === undefined || input === '') {
    return bad('Enter a weight from 1 to 1000, or a name like bold.')
  }
  if (NUMERIC.test(input)) {
    const value = Number(input)
    return value >= 1 && value <= 1000
      ? good(value)
      : bad('A weight is a number from 1 to 1000.')
  }
  if (NAME.test(input) && fontWeightToNumber(input) !== undefined) {
    return good(input)
  }
  return bad('Enter a weight from 1 to 1000, or a name like bold.')
}

export function formatFontWeight(value: FontWeight): string {
  return String(value)
}
