import { describe, expect, it } from 'vitest'
import { parseTokenParam } from '../../src/editor/tokenParam'

// ?token=<path> comes from the URL, so it is attacker-controlled. It is never
// trusted: anything that is not a plain token path is "invalid", which the page shows
// as a calm "token not found" state. It never reaches an object key, the DOM as
// markup, or a request.

describe('parseTokenParam', () => {
  it('no parameter means no selection', () => {
    expect(parseTokenParam(null)).toEqual({ kind: 'none' })
    expect(parseTokenParam('')).toEqual({ kind: 'none' })
  })

  it('a valid path is a path', () => {
    expect(parseTokenParam('primitive.color.blue-500')).toEqual({
      kind: 'path',
      path: 'primitive.color.blue-500',
    })
  })

  it.each([
    ['__proto__'],
    ['constructor'],
    ['prototype'],
    ['primitive.__proto__.x'],
    ['primitive.constructor'],
    ['x'.repeat(10_000)],
    ['a'.repeat(201)],
    ['a\u0000b'],
    ['a\nb'],
    ['a\tb'],
    ['a/b'],
    ['a\\b'],
    ['..'],
    ['../etc/passwd'],
    ['a%2Fb'],
    ['a%252Fb'],
    ['%2e%2e'],
    ['a b'],
    ['A.B'],
    ['a..b'],
    ['.a'],
    ['a.'],
    ['<script>alert(1)</script>'],
    ['a?x=1'],
    ['a#b'],
    ['‮'],
    ['{primitive.x}'],
  ])('%j is invalid, never a path', (raw) => {
    expect(parseTokenParam(raw)).toEqual({ kind: 'invalid' })
  })

  it('a path of exactly 200 characters is accepted, 201 is not', () => {
    const segment = 'a'.repeat(66)
    const at200 = [segment, segment, segment].join('.')
    expect(at200.length).toBe(200)
    expect(parseTokenParam(at200)).toEqual({ kind: 'path', path: at200 })
    expect(parseTokenParam(`${at200}c`)).toEqual({ kind: 'invalid' })
  })
})
