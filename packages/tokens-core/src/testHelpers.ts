import type {
  AliasToken,
  FontFamily,
  FontWeight,
  Issue,
  IssueCode,
  LiteralToken,
  SrgbColor,
  TokenType,
} from './types'

/** Builders for tests. Not part of the public API. */

export function color(
  path: string,
  components: [number, number, number] = [0, 0, 0],
): LiteralToken {
  return { path, type: 'color', value: { colorSpace: 'srgb', components } }
}

export function num(path: string, value = 1): LiteralToken {
  return { path, type: 'number', value }
}

export function dim(
  path: string,
  value = 1,
  unit: 'px' | 'rem' = 'px',
): LiteralToken {
  return { path, type: 'dimension', value: { value, unit } }
}

export function colorA(
  path: string,
  components: [number, number, number],
  alpha?: number,
  hex?: string,
): LiteralToken {
  const value: SrgbColor = { colorSpace: 'srgb', components }
  if (alpha !== undefined) value.alpha = alpha
  if (hex !== undefined) value.hex = hex
  return { path, type: 'color', value }
}

export function fontFamily(path: string, value: FontFamily): LiteralToken {
  return { path, type: 'fontFamily', value }
}

export function fontWeight(path: string, value: FontWeight): LiteralToken {
  return { path, type: 'fontWeight', value }
}

export function alias(
  path: string,
  target: string,
  type?: TokenType,
): AliasToken {
  return type === undefined
    ? { path, alias: target }
    : { path, alias: target, type }
}

export function codes(issues: readonly Issue[]): IssueCode[] {
  return issues.map((issue) => issue.code)
}

export function withCode(
  issues: readonly Issue[],
  code: IssueCode,
): Issue | undefined {
  return issues.find((issue) => issue.code === code)
}

export function errors(issues: readonly Issue[]): Issue[] {
  return issues.filter((issue) => issue.severity === 'error')
}
