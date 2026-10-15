import { bad, cleanInput, good, type Parsed } from './result'

const DECIMAL = /^-?\d{1,15}(?:\.\d{1,15})?$/
const MAX_ABS = 1e9

export function parseNumber(text: string): Parsed<number> {
  const input = cleanInput(text)
  if (input === undefined || !DECIMAL.test(input)) {
    return bad('Enter a decimal number like 1.5.')
  }
  const value = Number(input) + 0 // + 0 turns -0 into 0
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS) {
    return bad('That number is too large.')
  }
  return good(value)
}

export function formatNumber(value: number): string {
  return String(value)
}
