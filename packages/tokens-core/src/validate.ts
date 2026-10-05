import { error, hasError, warning } from './issues'
import type {
  Dimension,
  FontFamily,
  FontWeight,
  Issue,
  SrgbColor,
  TokenType,
  TokenValue,
  TokenValueMap,
} from './types'

export type ValidationResult<T = TokenValue> =
  { ok: true; value: T; issues: Issue[] } | { ok: false; issues: Issue[] }

/** All color space keys defined by the DTCG Color module (2025.10). Only srgb is supported. */
const SPEC_COLOR_SPACES = new Set([
  'srgb',
  'srgb-linear',
  'hsl',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz-d65',
  'xyz-d50',
])

const FONT_WEIGHT_NAMES = new Set([
  'thin',
  'hairline',
  'extra-light',
  'ultra-light',
  'light',
  'normal',
  'regular',
  'book',
  'medium',
  'semi-bold',
  'demi-bold',
  'bold',
  'extra-bold',
  'ultra-bold',
  'black',
  'heavy',
  'extra-black',
  'ultra-black',
])

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function looksLikeAlias(value: string): boolean {
  return value.startsWith('{') && value.endsWith('}')
}

/** A property-level `{ "$ref": ... }` sub-value, which is valid DTCG but out of subset. */
function isRefObject(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, '$ref')
}

function invalid(path: string, message: string, field: string): Issue {
  return error('INVALID_VALUE', path, message, { field })
}

function unsupported(path: string, message: string, field: string): Issue {
  return error('UNSUPPORTED_FEATURE', path, message, { field })
}

function done<T>(issues: Issue[], value: T): ValidationResult<T> {
  return hasError(issues) ? { ok: false, issues } : { ok: true, value, issues }
}

function fail(issues: Issue[]): ValidationResult<never> {
  return { ok: false, issues }
}

function unknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  what: string,
): Issue[] {
  return Object.keys(raw)
    .filter((key) => !allowed.includes(key))
    .map((key) =>
      invalid(path, `Unknown property "${key}" in ${what}`, `$value.${key}`),
    )
}

/** Per-channel tolerance of one 8-bit step, so 0.5 may be written #7f or #80. */
function hexDisagrees(
  components: readonly [number, number, number],
  hex: string,
): boolean {
  return components.some((component, index) => {
    const start = 1 + index * 2
    const byte = Number.parseInt(hex.slice(start, start + 2), 16)
    return Math.abs(Math.round(component * 255) - byte) > 1
  })
}

function validateColor(
  raw: unknown,
  path: string,
): ValidationResult<SrgbColor> {
  if (!isRecord(raw)) {
    return fail([
      invalid(
        path,
        'A color value must be an object with colorSpace and components',
        '$value',
      ),
    ])
  }

  const issues = unknownKeys(
    raw,
    ['colorSpace', 'components', 'alpha', 'hex'],
    path,
    'a color value',
  )

  const space = raw['colorSpace']
  if (typeof space !== 'string') {
    issues.push(
      invalid(
        path,
        'colorSpace is required and must be a string',
        '$value.colorSpace',
      ),
    )
    return fail(issues)
  }
  if (space !== 'srgb') {
    issues.push(
      SPEC_COLOR_SPACES.has(space)
        ? error(
            'UNSUPPORTED_COLOR_SPACE',
            path,
            `Color space "${space}" is not supported; only "srgb" is`,
            { field: '$value.colorSpace' },
          )
        : invalid(
            path,
            `"${space}" is not a DTCG color space`,
            '$value.colorSpace',
          ),
    )
    return fail(issues)
  }

  const components: number[] = []
  const rawComponents = raw['components']
  if (!Array.isArray(rawComponents) || rawComponents.length !== 3) {
    issues.push(
      invalid(
        path,
        'components must be an array of three numbers [red, green, blue]',
        '$value.components',
      ),
    )
  } else {
    rawComponents.forEach((component: unknown, index) => {
      const field = `$value.components[${index}]`
      if (isFiniteNumber(component) && component >= 0 && component <= 1) {
        components.push(component)
      } else if (component === 'none') {
        issues.push(
          unsupported(path, 'The "none" keyword is not supported', field),
        )
      } else if (isRefObject(component)) {
        issues.push(
          unsupported(
            path,
            'References inside a color are not supported',
            field,
          ),
        )
      } else {
        issues.push(
          invalid(
            path,
            'An srgb component must be a number from 0 to 1',
            field,
          ),
        )
      }
    })
  }

  const alpha = raw['alpha']
  if (
    alpha !== undefined &&
    !(isFiniteNumber(alpha) && alpha >= 0 && alpha <= 1)
  ) {
    issues.push(
      invalid(path, 'alpha must be a number from 0 to 1', '$value.alpha'),
    )
  }

  const hex = raw['hex']
  if (
    hex !== undefined &&
    !(typeof hex === 'string' && HEX_PATTERN.test(hex))
  ) {
    issues.push(
      invalid(
        path,
        'hex must be 6-digit notation like "#1a2b3c"',
        '$value.hex',
      ),
    )
  }

  const [red, green, blue] = components
  if (
    hasError(issues) ||
    red === undefined ||
    green === undefined ||
    blue === undefined
  ) {
    return fail(issues)
  }

  const value: SrgbColor = {
    colorSpace: 'srgb',
    components: [red, green, blue],
  }
  if (alpha !== undefined) value.alpha = alpha as number
  if (hex !== undefined) {
    value.hex = hex as string
    if (hexDisagrees(value.components, value.hex)) {
      issues.push(
        warning(
          'HEX_MISMATCH',
          path,
          `hex ${value.hex} differs from the components by more than one 8-bit step in a channel`,
          { field: '$value.hex' },
        ),
      )
    }
  }
  return done(issues, value)
}

function validateDimension(
  raw: unknown,
  path: string,
): ValidationResult<Dimension> {
  if (!isRecord(raw)) {
    return fail([
      invalid(
        path,
        'A dimension must be an object with value and unit',
        '$value',
      ),
    ])
  }

  const issues = unknownKeys(raw, ['value', 'unit'], path, 'a dimension')

  const value = raw['value']
  if (isRefObject(value)) {
    issues.push(
      unsupported(
        path,
        'References inside a dimension are not supported',
        '$value.value',
      ),
    )
  } else if (!isFiniteNumber(value)) {
    issues.push(invalid(path, 'value must be a finite number', '$value.value'))
  }

  const unit = raw['unit']
  if (unit !== 'px' && unit !== 'rem') {
    issues.push(invalid(path, 'unit must be "px" or "rem"', '$value.unit'))
  }

  if (hasError(issues) || !isFiniteNumber(value)) return fail(issues)
  return done(issues, { value, unit: unit as Dimension['unit'] })
}

function validateFontFamily(
  raw: unknown,
  path: string,
): ValidationResult<FontFamily> {
  if (typeof raw === 'string') {
    return raw.trim() === ''
      ? fail([invalid(path, 'A font name must not be empty', '$value')])
      : done([], raw)
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail([
      invalid(
        path,
        'A fontFamily must be a font name or a non-empty array of font names',
        '$value',
      ),
    ])
  }

  const issues: Issue[] = []
  const names: string[] = []
  raw.forEach((name: unknown, index) => {
    const field = `$value[${index}]`
    if (typeof name !== 'string' || name.trim() === '') {
      issues.push(
        invalid(path, 'Each font name must be a non-empty string', field),
      )
    } else if (looksLikeAlias(name)) {
      issues.push(
        unsupported(
          path,
          'References inside a fontFamily array are not supported',
          field,
        ),
      )
    } else {
      names.push(name)
    }
  })
  return done(issues, names)
}

function validateFontWeight(
  raw: unknown,
  path: string,
): ValidationResult<FontWeight> {
  const ok =
    (isFiniteNumber(raw) && raw >= 1 && raw <= 1000) ||
    (typeof raw === 'string' && FONT_WEIGHT_NAMES.has(raw))
  return ok
    ? done([], raw)
    : fail([
        invalid(
          path,
          'A fontWeight must be a number from 1 to 1000 or a named weight such as "bold"',
          '$value',
        ),
      ])
}

function validateNumber(raw: unknown, path: string): ValidationResult<number> {
  return isFiniteNumber(raw)
    ? done([], raw)
    : fail([invalid(path, 'A number token must be a finite number', '$value')])
}

const validators = {
  color: validateColor,
  dimension: validateDimension,
  fontFamily: validateFontFamily,
  fontWeight: validateFontWeight,
  number: validateNumber,
} satisfies {
  [T in TokenType]: (
    raw: unknown,
    path: string,
  ) => ValidationResult<TokenValueMap[T]>
}

/**
 * Validates a literal `$value` against its declared type. Never throws: bad
 * input produces issues. Warnings (such as HEX_MISMATCH) keep `ok` true.
 * The returned value is a fresh copy, never the input object.
 */
export function validateLiteral<T extends TokenType>(
  type: T,
  raw: unknown,
  path: string,
): ValidationResult<TokenValueMap[T]> {
  return validators[type](raw, path) as ValidationResult<TokenValueMap[T]>
}

/** Copies a validated value so tokens, resolved tokens and trees never share objects. */
export function cloneValue<V extends TokenValue>(value: V): V {
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return [...value] as V
  if ('components' in value) {
    return { ...value, components: [...value.components] }
  }
  return { ...value }
}
