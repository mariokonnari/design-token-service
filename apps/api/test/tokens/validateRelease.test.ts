import { nest, resolve, toCssVariables } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { RELEASE_LIMITS } from '../../src/releases/limits'
import { rowToToken, type TokenRowInput } from '../../src/tokens/mapper'
import {
  DEFAULT_RULES,
  defaultRules,
  validateDraft,
  type Rule,
} from '../../src/tokens/validateDraft'

// What a RELEASE needs from a draft (ADR 0015). Both rules are DEFAULT rules of
// validateDraft, so GET /validate and publish always agree.

const COLOR = { colorSpace: 'srgb', components: [0, 0, 0] }
let n = 0
const row = (
  path: string,
  type: string | null,
  value: unknown,
  description: string | null = null,
): TokenRowInput => ({ path, type, value, description, version: ++n })

const blue = row('primitive.color.blue', 'color', COLOR)
const action = row('semantic.color.action', null, '{primitive.color.blue}')

describe('validateDraft: NOTHING_TO_EXPORT', () => {
  it('a draft of only primitives resolves fine but exports nothing: error, not publishable', () => {
    const result = validateDraft([blue])
    expect(result.publishable).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'NOTHING_TO_EXPORT',
        severity: 'error',
        path: '',
      }),
    ])
  })

  it.each([
    ['a semantic literal', [row('semantic.n.x', 'number', 1)]],
    ['a component literal', [row('component.n.x', 'number', 1)]],
    ['a semantic alias to a primitive', [blue, action]],
  ])('%s exports something, so it is publishable', (_name, rows) => {
    expect(validateDraft(rows)).toEqual({ issues: [], publishable: true })
  })

  it('is not added to drafts that already have a more specific problem (empty, unresolved, only unmappable rows)', () => {
    expect(validateDraft([]).issues.map((i) => i.code)).toEqual(['EMPTY_DRAFT'])
    expect(validateDraft([action]).issues.map((i) => i.code)).toEqual([
      'ALIAS_NOT_FOUND',
    ])
    expect(
      validateDraft([row('primitive.color.broken', 'color', 'x')]).issues.map(
        (i) => i.code,
      ),
    ).toEqual(['UNMAPPABLE_ROW'])
  })
})

/** The size the rule measures, computed independently here: snapshot JSON + root-scope CSS. */
function releaseBytes(rows: TokenRowInput[]): number {
  const tokens = rows.flatMap((r) => {
    const mapped = rowToToken(r)
    return mapped.ok ? [mapped.token] : []
  })
  const { resolved } = resolve(tokens)
  const css = toCssVariables(resolved, { include: ['semantic', 'component'] })
  return (
    Buffer.byteLength(JSON.stringify(nest(tokens).tree)) +
    Buffer.byteLength(css.css)
  )
}

const family = (length: number) => ['a'.repeat(length)]
const tooLarge = (rows: TokenRowInput[], cap?: number) =>
  (cap === undefined
    ? validateDraft(rows)
    : validateDraft(rows, defaultRules(cap), { maxReleaseBytes: cap })
  ).issues.filter((i) => i.code === 'RELEASE_TOO_LARGE')

describe('validateDraft: RELEASE_TOO_LARGE (snapshot + root-scope CSS bytes)', () => {
  const rows = [
    row('semantic.font.body', 'fontFamily', family(300), 'x'.repeat(40)),
    row('component.font.title', null, '{semantic.font.body}'),
  ]

  it('exactly AT the cap is publishable; one byte over is not (small cap)', () => {
    const size = releaseBytes(rows)
    expect(size).toBeGreaterThan(600) // not vacuous
    expect(tooLarge(rows, size)).toEqual([])
    expect(
      validateDraft(rows, defaultRules(size), { maxReleaseBytes: size })
        .publishable,
    ).toBe(true)
    const over = validateDraft(rows, defaultRules(size - 1), {
      maxReleaseBytes: size - 1,
    })
    expect(over.publishable).toBe(false)
    expect(over.issues).toEqual([
      expect.objectContaining({
        code: 'RELEASE_TOO_LARGE',
        severity: 'error',
        path: '',
        message: expect.stringContaining(String(size - 1)) as unknown,
      }),
    ])
  })

  it('the REAL cap: exactly MAX_RELEASE_BYTES passes, one byte more fails', () => {
    const cap = RELEASE_LIMITS.MAX_RELEASE_BYTES
    // 140 semantic tokens with ~3.5 KB font families (each family character is
    // 2 bytes: snapshot + CSS), padded on the last token to the exact cap.
    // Every token has a 1-character description, so the `$description` key is always
    // present and the padding below is exact (1 byte per description character).
    const big: TokenRowInput[] = Array.from({ length: 140 }, (_, i) =>
      row(`semantic.font.f-${i}`, 'fontFamily', family(3500), 'd'),
    )
    const base = releaseBytes(big)
    expect(base).toBeLessThan(cap) // below the cap before padding
    const missing = cap - base
    expect(missing).toBeGreaterThan(0)
    const last = big[139] as TokenRowInput
    // a description character is 1 byte (snapshot only)
    last.value = family(3500 + Math.floor(missing / 2))
    last.description = 'd'.repeat(1 + (missing % 2))
    expect(releaseBytes(big)).toBe(cap)
    expect(tooLarge(big)).toEqual([])
    last.description = 'd'.repeat(2 + (missing % 2))
    expect(releaseBytes(big)).toBe(cap + 1)
    expect(tooLarge(big)).toHaveLength(1)
  })

  it('catches CSS AMPLIFICATION: a tiny stored draft whose aliases multiply one big value in the CSS', () => {
    const amplified = [
      row('semantic.font.big', 'fontFamily', family(4000)),
      ...Array.from({ length: 300 }, (_, i) =>
        row(`component.copy.c-${i}`, null, '{semantic.font.big}'),
      ),
    ]
    const raw = amplified.reduce(
      (sum, r) => sum + JSON.stringify(r.value).length,
      0,
    )
    expect(raw).toBeLessThan(RELEASE_LIMITS.MAX_RELEASE_BYTES / 10) // small as stored
    expect(releaseBytes(amplified)).toBeGreaterThan(
      RELEASE_LIMITS.MAX_RELEASE_BYTES,
    )
    expect(tooLarge(amplified)).toHaveLength(1)
  })

  it('SHORT-CIRCUITS on the raw stored bytes: no mapping, no resolve, no rules run', () => {
    let ran = 0
    const spy: Rule = () => {
      ran += 1
      return []
    }
    const huge = [row('semantic.font.huge', 'fontFamily', family(2000))]
    const result = validateDraft(huge, [spy], { maxReleaseBytes: 1000 })
    expect(ran).toBe(0)
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(['RELEASE_TOO_LARGE'])
  })

  it('the short-circuit never rejects a draft the exact rule accepts (raw stored bytes <= snapshot + CSS)', () => {
    const fine = [
      row('primitive.color.blue', 'color', COLOR, 'A description'),
      row('semantic.font.body', 'fontFamily', family(50)),
      row('semantic.color.action', null, '{primitive.color.blue}'),
    ]
    const size = releaseBytes(fine)
    expect(
      validateDraft(fine, defaultRules(size), { maxReleaseBytes: size }).issues,
    ).toEqual([])
  })

  it('a draft of realistic size (2000 small tokens) is nowhere near the cap', () => {
    const tokens = Array.from({ length: 2000 }, (_, i) =>
      row(`semantic.n.t-${i}`, 'number', i, 'A short description'),
    )
    expect(releaseBytes(tokens)).toBeLessThan(
      RELEASE_LIMITS.MAX_RELEASE_BYTES / 4,
    )
    expect(tooLarge(tokens)).toEqual([])
  })

  it('DEFAULT_RULES is the same list as defaultRules() with the real cap', () => {
    expect(DEFAULT_RULES).toHaveLength(defaultRules().length)
  })
})
