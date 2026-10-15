import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import {
  emptyForm,
  formFromToken,
  tokenFromForm,
  type FormField,
  type TokenForm,
} from '../../src/editor/form'
import { LIMITS } from '../../src/editor/limits'

// The form model behind the token editor: strings in, a validated tokens-core
// Token (or per-field messages) out. Pure.

const TOKENS: [string, Token][] = [
  [
    'color',
    {
      path: 'primitive.color.blue',
      type: 'color',
      value: { colorSpace: 'srgb', components: [0.145, 0.388, 0.922] },
      description: 'The brand blue',
    },
  ],
  [
    'color with alpha',
    {
      path: 'primitive.color.scrim',
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.4 },
    },
  ],
  [
    'dimension',
    {
      path: 'primitive.space.4',
      type: 'dimension',
      value: { value: 16, unit: 'px' },
    },
  ],
  [
    'fontFamily list',
    {
      path: 'primitive.font.sans',
      type: 'fontFamily',
      value: ['Helvetica Neue', 'sans-serif'],
    },
  ],
  [
    'fontWeight number',
    { path: 'primitive.font.bold', type: 'fontWeight', value: 700 },
  ],
  [
    'fontWeight name',
    { path: 'primitive.font.named', type: 'fontWeight', value: 'bold' },
  ],
  ['number', { path: 'primitive.ratio.golden', type: 'number', value: 1.618 }],
  ['alias', { path: 'semantic.color.action', alias: 'primitive.color.blue' }],
  [
    'alias with a declared type',
    {
      path: 'semantic.color.action2',
      alias: 'primitive.color.blue',
      type: 'color',
      description: 'declared',
    },
  ],
]

describe('formFromToken / tokenFromForm round trip', () => {
  it.each(TOKENS)('%s survives a round trip unchanged', (_label, token) => {
    const result = tokenFromForm(formFromToken(token), token)
    expect(result).toEqual({ ok: true, token })
  })

  it('an alias form has mode "alias" and shows the target in braces', () => {
    const form = formFromToken({ path: 'semantic.a', alias: 'primitive.b' })
    expect(form.mode).toBe('alias')
    expect(form.alias).toBe('{primitive.b}')
  })

  it('a color form has hex and alpha text and nothing in value', () => {
    const form = formFromToken(TOKENS[1]![1])
    expect(form.hex).toBe('#000000')
    expect(form.alpha).toBe('0.4')
    expect(form.value).toBe('')
  })
})

function literal(over: Partial<TokenForm>): TokenForm {
  return { ...emptyForm(), path: 'primitive.x.y', mode: 'literal', ...over }
}

describe('tokenFromForm: field errors', () => {
  it('a new literal needs a path and a type', () => {
    const result = tokenFromForm(emptyForm())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['path', 'type'])
    }
  })

  it.each([
    ['', 'empty'],
    ['Primitive.X', 'upper case'],
    ['a..b', 'empty segment'],
    ['a b', 'space'],
    ['a/b', 'slash'],
    ['__proto__', 'reserved'],
    ['primitive.constructor.x', 'reserved inside'],
    ['prototype', 'reserved'],
    ['a'.repeat(LIMITS.maxPathLength + 1), 'too long'],
    ['a\nb', 'newline'],
  ])('refuses the path %j (%s)', (path) => {
    const result = tokenFromForm(literal({ path, type: 'number', value: '1' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.path).toBeTruthy()
  })

  it('refuses a bad value per type, naming the field', () => {
    const cases: [Partial<TokenForm>, FormField][] = [
      [{ type: 'color', hex: 'blue' }, 'hex'],
      [{ type: 'color', hex: '#000', alpha: '2' }, 'alpha'],
      [{ type: 'dimension', value: '16' }, 'value'],
      [{ type: 'fontFamily', value: '"open' }, 'value'],
      [{ type: 'fontWeight', value: '0' }, 'value'],
      [{ type: 'number', value: 'abc' }, 'value'],
    ]
    for (const [over, field] of cases) {
      const result = tokenFromForm(literal(over))
      expect(result.ok, JSON.stringify(over)).toBe(false)
      if (!result.ok) expect(result.errors[field], field).toBeTruthy()
    }
  })

  it('an alias form needs a well formed target', () => {
    const bad = tokenFromForm(
      literal({ mode: 'alias', path: 'semantic.a', alias: '{A.b}' }),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.alias).toBeTruthy()
    const good = tokenFromForm(
      literal({ mode: 'alias', path: 'semantic.a', alias: 'primitive.b' }),
    )
    expect(good).toEqual({
      ok: true,
      token: { path: 'semantic.a', alias: 'primitive.b' },
    })
  })

  it('refuses a description over the limit and trims nothing silently', () => {
    const result = tokenFromForm(
      literal({
        type: 'number',
        value: '1',
        description: 'd'.repeat(LIMITS.maxDescriptionLength + 1),
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.description).toBeTruthy()
    const exact = tokenFromForm(
      literal({
        type: 'number',
        value: '1',
        description: 'd'.repeat(LIMITS.maxDescriptionLength),
      }),
    )
    expect(exact.ok).toBe(true)
  })

  it('refuses a font list that is longer than the editor accepts', () => {
    const family = Array.from(
      { length: 400 },
      (_, i) => `Font Number ${i}`,
    ).join(', ')
    expect(family.length).toBeGreaterThan(2000)
    const result = tokenFromForm(literal({ type: 'fontFamily', value: family }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.value).toBeTruthy()
  })

  it("the input caps keep EVERY accepted value far below the server's 8192-byte limit", () => {
    // The worst inputs the font editor can accept: 2000 characters of 4-byte
    // characters, of quotes that JSON escapes, and of one-letter names.
    const inputs = [
      '\u{1F600},'.repeat(400),
      '"\\"",'.repeat(400),
      'a,'.repeat(999) + 'a',
      '\u{1F600}'.repeat(500),
    ]
    for (const value of inputs) {
      const result = tokenFromForm(literal({ type: 'fontFamily', value }))
      if (result.ok && !('alias' in result.token)) {
        const bytes = new TextEncoder().encode(
          JSON.stringify(result.token.value),
        ).length
        expect(bytes).toBeLessThan(LIMITS.maxValueBytes)
      }
    }
  })

  it('an empty description is no description', () => {
    const result = tokenFromForm(literal({ type: 'number', value: '1' }))
    expect(result.ok && 'description' in result.token).toBe(false)
  })

  it('the original path is kept when editing (a path cannot be renamed here)', () => {
    const original: Token = {
      path: 'primitive.color.blue',
      type: 'number',
      value: 1,
    }
    const result = tokenFromForm(
      { ...formFromToken(original), path: 'primitive.color.other' },
      original,
    )
    expect(result.ok && result.token.path).toBe('primitive.color.blue')
  })
})
