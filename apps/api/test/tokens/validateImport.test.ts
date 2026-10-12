import { describe, expect, it } from 'vitest'
import { validateImport } from '../../src/tokens/validateImport'

const COLOR = { colorSpace: 'srgb', components: [0, 0, 0] }
const tree = (tokens: Record<string, unknown>) => ({
  primitive: { color: tokens },
})

describe('validateImport: valid', () => {
  it('flattens a tree into tokens, sorted', () => {
    const r = validateImport({
      semantic: { color: { action: { $value: '{primitive.color.blue}' } } },
      primitive: {
        color: {
          $type: 'color',
          red: { $value: COLOR },
          blue: { $value: COLOR },
        },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tokens.map((t) => t.path)).toEqual([
        'primitive.color.blue',
        'primitive.color.red',
        'semantic.color.action',
      ])
    }
  })

  it('returns warnings and still succeeds', () => {
    const r = validateImport({
      primitive: {
        color: {
          x: {
            $type: 'color',
            $value: { ...COLOR, hex: '#ffffff' },
            $extensions: { vendor: true },
          },
        },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.map((w) => w.code).sort()).toEqual([
        'HEX_MISMATCH',
        'UNSUPPORTED_FEATURE',
      ])
    }
  })

  it('an alias to a token that is not in the import is fine (drafts may be invalid)', () => {
    expect(
      validateImport({ semantic: { a: { $value: '{primitive.missing}' } } }).ok,
    ).toBe(true)
  })
})

describe('validateImport: the WHOLE import is refused on any error', () => {
  const codes = (value: unknown) => {
    const r = validateImport(value)
    return r.ok ? [] : r.issues.map((i) => i.code)
  }

  it.each([
    [
      'a bad name',
      tree({ 'Bad Name': { $type: 'color', $value: COLOR } }),
      'INVALID_NAME',
    ],
    ['a missing type', tree({ x: { $value: 1 } }), 'MISSING_TYPE'],
    [
      'an invalid value',
      tree({ x: { $type: 'number', $value: 'nope' } }),
      'INVALID_VALUE',
    ],
    [
      'an unsupported type',
      tree({ x: { $type: 'gradient', $value: 1 } }),
      'UNSUPPORTED_TYPE',
    ],
    ['a $ref', tree({ x: { $ref: '#/a' } }), 'UNSUPPORTED_FEATURE'],
    [
      'a token with children',
      tree({ x: { $type: 'number', $value: 1, child: {} } }),
      'INVALID_STRUCTURE',
    ],
    ['a non-object root', [], 'INVALID_STRUCTURE'],
    ['a null root', null, 'INVALID_STRUCTURE'],
  ])('%s', (_label, value, code) => {
    expect(codes(value)).toContain(code)
  })

  it('one bad token among good ones refuses everything', () => {
    const r = validateImport(
      tree({
        good: { $type: 'number', $value: 1 },
        bad: { $type: 'number', $value: 'x' },
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('1e999 (Infinity) is rejected, never turned into null', () => {
    const parsed = JSON.parse(
      '{"p":{"n":{"$type":"number","$value":1e999},"d":{"$type":"dimension","$value":{"value":1e999,"unit":"px"}}}}',
    ) as unknown
    const r = validateImport(parsed)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.issues.map((i) => i.path).sort()).toEqual(['p.d', 'p.n'])
  })

  it('an EMPTY import is refused (a replace with nothing would wipe the draft by accident)', () => {
    for (const value of [{}, { primitive: {} }, { a: { b: {} } }]) {
      const r = validateImport(value)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.issues[0]?.message).toMatch(/no tokens/i)
    }
  })

  it('the structure guard runs first: a 50,000-level tree is refused fast', () => {
    let node: unknown = { $type: 'number', $value: 1 }
    for (let i = 0; i < 50_000; i++) node = { a: node }
    const started = performance.now()
    const r = validateImport(node)
    expect(performance.now() - started).toBeLessThan(250)
    expect(r.ok).toBe(false)
  })

  it('reserved names are refused', () => {
    const r = validateImport(
      JSON.parse('{"primitive":{"constructor":{"$type":"number","$value":1}}}'),
    )
    expect(r.ok).toBe(false)
  })
})

describe('validateImport: the SAME per-token limits as PUT', () => {
  const limited = (token: Record<string, unknown>, name = 'x') =>
    validateImport(tree({ [name]: token }))
  const fieldsOf = (r: ReturnType<typeof validateImport>) =>
    r.ok ? [] : r.issues.map((i) => i.field)

  it('path: 200 characters pass, 201 fail', () => {
    // primitive.color. = 16 characters; the final segment makes the total
    const total = (n: number) => 'a'.repeat(n - 'primitive.color.'.length)
    expect(limited({ $type: 'number', $value: 1 }, total(200)).ok).toBe(true)
    const over = limited({ $type: 'number', $value: 1 }, total(201))
    expect(over.ok).toBe(false)
    expect(fieldsOf(over)).toContain('path')
  })

  it('description: 500 characters pass, 501 fail', () => {
    expect(
      limited({ $type: 'number', $value: 1, $description: 'x'.repeat(500) }).ok,
    ).toBe(true)
    const over = limited({
      $type: 'number',
      $value: 1,
      $description: 'x'.repeat(501),
    })
    expect(over.ok).toBe(false)
    expect(fieldsOf(over)).toContain('description')
  })

  it('value: 8192 bytes of JSON pass, 8193 fail', () => {
    const sized = (bytes: number) => ({
      $type: 'fontFamily',
      $value: ['x'.repeat(bytes - 4)],
    })
    expect(limited(sized(8192)).ok).toBe(true)
    const over = limited(sized(8193))
    expect(over.ok).toBe(false)
    expect(fieldsOf(over)).toContain('value')
  })

  it('token count: 2000 pass, 2001 fail', () => {
    const many = (n: number) => {
      const tokens: Record<string, unknown> = {}
      for (let i = 0; i < n; i++)
        tokens[`t${i}`] = { $type: 'number', $value: i }
      return tree(tokens)
    }
    expect(validateImport(many(2000)).ok).toBe(true)
    const over = validateImport(many(2001))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.issues[0]?.message).toMatch(/2000/)
  })
})
