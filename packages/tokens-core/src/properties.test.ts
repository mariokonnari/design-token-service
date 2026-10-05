import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { resolve } from './resolve'
import { flatten, nest } from './tree'
import { TOKEN_TYPES, type Token, type TokenType } from './types'
import { alias, dim, num } from './testHelpers'

// Property tests use small generators and a bounded number of runs so CI stays fast.
const NUM_RUNS = 100

// --- generators for valid trees -------------------------------------------

const word = fc
  .array(fc.constantFrom(...'abcxyz0129'.split('')), {
    minLength: 1,
    maxLength: 3,
  })
  .map((chars) => chars.join(''))

const nameArb = fc
  .tuple(word, fc.option(word, { nil: undefined }))
  .map(([first, second]) =>
    second === undefined ? first : `${first}-${second}`,
  )

const pathArb = fc
  .array(nameArb, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('.'))

const unit = fc.double({ min: 0, max: 1, noNaN: true })
const finite = fc.double({ noNaN: true, noDefaultInfinity: true })
const fontName = fc
  .array(fc.constantFrom(...'abcXYZ '.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(''))
  .filter((name) => name.trim() !== '')

const valueFor: Record<TokenType, fc.Arbitrary<unknown>> = {
  color: fc.record(
    {
      colorSpace: fc.constant('srgb'),
      components: fc.tuple(unit, unit, unit),
      alpha: unit,
    },
    { requiredKeys: ['colorSpace', 'components'] },
  ),
  dimension: fc.record({ value: finite, unit: fc.constantFrom('px', 'rem') }),
  fontFamily: fc.oneof(
    fontName,
    fc.array(fontName, { minLength: 1, maxLength: 3 }),
  ),
  fontWeight: fc.oneof(
    fc.integer({ min: 1, max: 1000 }),
    fc.constantFrom('thin', 'regular', 'bold', 'extra-black'),
  ),
  number: finite,
}

const typeArb = fc.constantFrom(...TOKEN_TYPES)

const literalArb = typeArb.chain((type) =>
  valueFor[type].map((value) => ({ $type: type, $value: value })),
)

const aliasArb = fc
  .tuple(pathArb, fc.option(typeArb, { nil: undefined }))
  .map(([target, type]) =>
    type === undefined
      ? { $value: `{${target}}` }
      : { $type: type, $value: `{${target}}` },
  )

const tokenArb = fc
  .tuple(
    fc.oneof(literalArb, aliasArb),
    fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
  )
  .map(([token, description]) =>
    description === undefined ? token : { ...token, $description: description },
  )

// A group whose tokens inherit their type from the group's $type.
const typedGroupArb = typeArb.chain((type) =>
  fc
    .dictionary(
      nameArb,
      valueFor[type].map((value) => ({ $value: value })),
      { minKeys: 1, maxKeys: 3 },
    )
    .map((children) => ({ $type: type, ...children })),
)

const treeArb = fc.letrec<{ node: unknown; group: Record<string, unknown> }>(
  (tie) => ({
    node: fc.oneof({ maxDepth: 2 }, tokenArb, typedGroupArb, tie('group')),
    group: fc.dictionary(nameArb, tie('node'), { minKeys: 1, maxKeys: 3 }),
  }),
).group

describe('property: flatten / nest round trip', () => {
  it('flatten(nest(flatten(tree))) equals flatten(tree) for valid trees', () => {
    fc.assert(
      fc.property(treeArb, (tree) => {
        const first = flatten(tree)
        expect(first.issues).toEqual([])
        expect(first.rejected).toEqual([])

        const nested = nest(first.tokens)
        expect(nested.issues).toEqual([])

        const second = flatten(nested.tree)
        expect(second.issues).toEqual([])
        expect(second.tokens).toEqual(first.tokens)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// --- generators for arbitrary alias graphs ---------------------------------

const poolPath = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f')
const targetPath = fc.constantFrom(
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'missing',
  'rej',
)

const entryArb = fc.oneof(
  fc
    .constantFrom<'number' | 'dimension'>('number', 'dimension')
    .map((kind) => ({
      kind: 'literal' as const,
      literal: kind,
    })),
  fc
    .tuple(targetPath, fc.option(typeArb, { nil: undefined }))
    .map(([target, declared]) => ({
      kind: 'alias' as const,
      target,
      declared,
    })),
)

const graphArb = fc
  .dictionary(poolPath, entryArb, { minKeys: 1, maxKeys: 6 })
  .map((entries): Token[] =>
    Object.entries(entries).map(([path, entry]) => {
      if (entry.kind === 'literal') {
        return entry.literal === 'number' ? num(path) : dim(path)
      }
      return alias(path, entry.target, entry.declared)
    }),
  )

describe('property: resolve on arbitrary alias graphs', () => {
  it('never throws, accounts for every token, and is order independent', () => {
    fc.assert(
      fc.property(
        graphArb,
        fc.subarray(['rej', 'missing']),
        (tokens, rejected) => {
          const inputPaths = new Set(tokens.map((token) => token.path))
          const result = resolve(tokens, { rejected })

          const resolvedPaths = new Set(
            result.resolved.map((token) => token.path),
          )
          const errorPaths = new Set(
            result.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.path),
          )

          for (const path of resolvedPaths)
            expect(inputPaths.has(path)).toBe(true)
          for (const issue of result.issues) {
            expect(inputPaths.has(issue.path)).toBe(true)
          }
          // Every token is either resolved or explained by an error, never both.
          for (const path of inputPaths) {
            expect(resolvedPaths.has(path) !== errorPaths.has(path)).toBe(true)
          }

          expect(resolve([...tokens].reverse(), { rejected })).toEqual(result)
        },
      ),
      { numRuns: NUM_RUNS * 2 },
    )
  })
})
