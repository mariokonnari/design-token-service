import {
  TOKEN_TYPES,
  isValidName,
  splitPath,
  validateLiteral,
  type SrgbColor,
  type Token,
  type TokenType,
  type TokenValue,
} from '@dts/tokens-core'
import { LIMITS, RESERVED_NAMES } from './limits'
import { formatAlias, parseAliasText } from './values/alias'
import { formatColor, parseColor } from './values/color'
import { formatDimension, parseDimension } from './values/dimension'
import { formatFontFamily, parseFontFamily } from './values/fontFamily'
import { formatFontWeight, parseFontWeight } from './values/fontWeight'
import { formatNumber, parseNumber } from './values/number'

/**
 * The form model behind the token editor: strings in, a validated tokens-core Token
 * (or one message per field) out. Pure; the React form only holds a TokenForm.
 */

export type FormField =
  'path' | 'type' | 'value' | 'hex' | 'alpha' | 'alias' | 'description'

export type FormErrors = Partial<Record<FormField, string>>

export interface TokenForm {
  path: string
  mode: 'literal' | 'alias'
  /** The literal's type; for an alias the OPTIONAL declared type ('' means none). */
  type: TokenType | ''
  /** The text of a dimension, fontFamily, fontWeight or number. */
  value: string
  hex: string
  alpha: string
  /** `{path.to.token}` or the bare path. */
  alias: string
  description: string
}

export function emptyForm(): TokenForm {
  return {
    path: '',
    mode: 'literal',
    type: '',
    value: '',
    hex: '',
    alpha: '',
    alias: '',
    description: '',
  }
}

export function formFromToken(token: Token): TokenForm {
  const form: TokenForm = {
    ...emptyForm(),
    path: token.path,
    description: token.description ?? '',
  }
  if ('alias' in token) {
    return {
      ...form,
      mode: 'alias',
      alias: formatAlias(token.alias),
      type: token.type ?? '',
    }
  }
  form.type = token.type
  switch (token.type) {
    case 'color': {
      const { hex, alpha } = formatColor(token.value)
      return { ...form, hex, alpha }
    }
    case 'dimension':
      return { ...form, value: formatDimension(token.value) }
    case 'fontFamily':
      return { ...form, value: formatFontFamily(token.value) }
    case 'fontWeight':
      return { ...form, value: formatFontWeight(token.value) }
    case 'number':
      return { ...form, value: formatNumber(token.value) }
  }
}

function isTokenType(value: string): value is TokenType {
  return (TOKEN_TYPES as readonly string[]).includes(value)
}

function pathProblem(path: string): string | undefined {
  if (path === '') return 'Enter a path, like primitive.color.blue-500.'
  if (path.length > LIMITS.maxPathLength) {
    return `A path may be at most ${LIMITS.maxPathLength} characters.`
  }
  const segments = splitPath(path)
  const reserved = segments.find((segment) => RESERVED_NAMES.has(segment))
  if (reserved !== undefined) {
    return `"${reserved}" is a reserved name and cannot be used in a path.`
  }
  if (!segments.every(isValidName)) {
    return 'A path is dot-separated names of lowercase letters, digits and single hyphens.'
  }
  return undefined
}

/**
 * The token a form describes, or a message per field. When editing, `original`
 * gives the path (a path cannot be renamed here) and the colour components that an
 * unchanged hex keeps.
 */
export function tokenFromForm(
  form: TokenForm,
  original?: Token,
): { ok: true; token: Token } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {}
  const path = original?.path ?? form.path
  if (original === undefined) {
    const problem = pathProblem(path)
    if (problem !== undefined) errors.path = problem
  }

  if (form.description.length > LIMITS.maxDescriptionLength) {
    errors.description = `A description may be at most ${LIMITS.maxDescriptionLength} characters.`
  }

  let token: Token | undefined

  if (form.mode === 'alias') {
    const target = parseAliasText(form.alias)
    if (!target.ok) errors.alias = target.message
    if (form.type !== '' && !isTokenType(form.type)) {
      errors.type = 'Choose one of the listed types.'
    }
    if (target.ok && errors.type === undefined) {
      token = { path, alias: target.value }
      if (form.type !== '') token.type = form.type
    }
  } else if (form.type === '') {
    errors.type = 'Choose a type.'
  } else if (!isTokenType(form.type)) {
    errors.type = 'Choose one of the listed types.'
  } else {
    token = literalToken(form, path, original, errors)
  }

  if (token !== undefined) {
    // The editors cap their input (2000 characters), so no value they accept can
    // reach the API limit of 8192 bytes of JSON (pinned by a test); the server still checks.
    if (form.description !== '') token.description = form.description
  }

  if (Object.keys(errors).length > 0 || token === undefined) {
    return { ok: false, errors }
  }
  return { ok: true, token }
}

function literalToken(
  form: TokenForm,
  path: string,
  original: Token | undefined,
  errors: FormErrors,
): Token | undefined {
  const type = form.type as TokenType
  let value: TokenValue | undefined
  const originalColor: SrgbColor | undefined =
    original !== undefined &&
    !('alias' in original) &&
    original.type === 'color'
      ? original.value
      : undefined

  switch (type) {
    case 'color': {
      const parsed = parseColor(form.hex, form.alpha, originalColor)
      if (parsed.ok) value = parsed.value
      else if (/alpha/i.test(parsed.message)) errors.alpha = parsed.message
      else errors.hex = parsed.message
      break
    }
    case 'dimension': {
      const parsed = parseDimension(form.value)
      if (parsed.ok) value = parsed.value
      else errors.value = parsed.message
      break
    }
    case 'fontFamily': {
      const parsed = parseFontFamily(form.value)
      if (parsed.ok) value = parsed.value
      else errors.value = parsed.message
      break
    }
    case 'fontWeight': {
      const parsed = parseFontWeight(form.value)
      if (parsed.ok) value = parsed.value
      else errors.value = parsed.message
      break
    }
    case 'number': {
      const parsed = parseNumber(form.value)
      if (parsed.ok) value = parsed.value
      else errors.value = parsed.message
      break
    }
  }
  if (value === undefined) return undefined

  // The very same check the server runs on a literal.
  const checked = validateLiteral(type, value, path)
  if (!checked.ok) {
    errors[type === 'color' ? 'hex' : 'value'] =
      checked.issues[0]?.message ?? 'This value is not valid.'
    return undefined
  }
  return { path, type, value: checked.value } as Token
}
