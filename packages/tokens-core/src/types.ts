/** Token types in the supported subset of DTCG 2025.10 (see ADR 0006). */
export const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'number',
] as const

export type TokenType = (typeof TOKEN_TYPES)[number]

export interface SrgbColor {
  colorSpace: 'srgb'
  /** Red, green, blue; each in [0, 1]. */
  components: [number, number, number]
  /** In [0, 1]. Absent means fully opaque. */
  alpha?: number
  /** Fallback in 6-digit `#rrggbb` form. */
  hex?: string
}

export interface Dimension {
  value: number
  unit: 'px' | 'rem'
}

/** A single font name or an ordered list, most preferred first. */
export type FontFamily = string | string[]

/** A number in [1, 1000] or one of the named weights, kept as written. */
export type FontWeight = number | string

export interface TokenValueMap {
  color: SrgbColor
  dimension: Dimension
  fontFamily: FontFamily
  fontWeight: FontWeight
  number: number
}

export type TokenValue = TokenValueMap[TokenType]

interface TokenBase {
  /** Dotted path, e.g. `primitive.color.blue-500`. Segments never contain `.`. */
  path: string
  description?: string
}

/** A token holding a validated literal value. */
export type LiteralToken = {
  [T in TokenType]: TokenBase & { type: T; value: TokenValueMap[T] }
}[TokenType]

/** A token whose value is a reference to another token. */
export interface AliasToken extends TokenBase {
  /** Dotted path of the target token, without braces. */
  alias: string
  /**
   * The explicitly declared `$type`, if any. Group `$type` is not inherited by
   * aliases (DTCG 2025.10 section 5.2.2): the type comes from the target.
   */
  type?: TokenType
}

export type Token = LiteralToken | AliasToken

/** A token whose alias chain has been followed down to a literal. */
export type ResolvedToken = {
  [T in TokenType]: {
    path: string
    type: T
    value: TokenValueMap[T]
    description?: string
    /** The direct alias target, when this token is an alias. */
    aliasOf?: string
    /** The literal token at the end of the alias chain, when this token is an alias. */
    resolvesTo?: string
  }
}[TokenType]

export const ISSUE_CODES = [
  'INVALID_NAME',
  'INVALID_TYPE',
  'MISSING_TYPE',
  'UNSUPPORTED_TYPE',
  'UNSUPPORTED_COLOR_SPACE',
  'UNSUPPORTED_FEATURE',
  'INVALID_STRUCTURE',
  'INVALID_VALUE',
  'HEX_MISMATCH',
  'PATH_CONFLICT',
  'ALIAS_NOT_FOUND',
  'ALIAS_TARGET_INVALID',
  'ALIAS_CYCLE',
  'TYPE_MISMATCH',
  'TIER_VIOLATION',
] as const

export type IssueCode = (typeof ISSUE_CODES)[number]

export interface Issue {
  code: IssueCode
  severity: 'error' | 'warning'
  /** Path of the token or group at fault; `''` for the document root. */
  path: string
  message: string
  /** The specific input field at fault, e.g. `$value.components[1]`. */
  field?: string
  /** Other paths involved, e.g. the members of an alias cycle. */
  related?: readonly string[]
}

/** A nested DTCG-style object: groups are objects, tokens carry `$value`. */
export type TokenTree = { [key: string]: unknown }
