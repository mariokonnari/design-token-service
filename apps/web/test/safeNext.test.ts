import { describe, expect, it } from 'vitest'
import { loginPathFor, safeNext } from '../src/auth/safeNext'

// `next` comes from the URL, so it is attacker-controlled: a link such as
// /login?next=//evil.com must never send a freshly signed-in user to another site.
// safeNext accepts ONLY a same-origin path and otherwise returns the fallback.

describe('safeNext: accepts same-origin paths unchanged', () => {
  it.each([
    '/',
    '/orgs',
    '/orgs/0b0a6b2e-6f41-4a43-8d3f-5f7d2f2b6a11',
    '/orgs/a/brands/b?tab=tokens&x=1#section',
    '/orgs/a%20b',
    '/a:b',
    '/loginx',
    '/orgs/login',
    `/${'a'.repeat(511)}`, // exactly 512 characters
  ])('%j', (value) => {
    expect(safeNext(value)).toBe(value)
  })
})

describe('safeNext: hostile inputs fall back', () => {
  const hostile: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 5],
    ['an array', ['/ok']],
    ['an object', { toString: () => '/ok' }],
    ['the empty string', ''],
    ['a relative path', 'orgs/1'],
    ['a dot path', './orgs'],
    ['a protocol-relative URL', '//evil.com'],
    ['a protocol-relative URL with a path', '//evil.com/orgs'],
    ['only two slashes', '//'],
    ['three slashes', '///evil.com'],
    ['slash backslash', '/\\evil.com'],
    ['two backslashes', '\\\\evil.com'],
    ['backslash slash', '\\/evil.com'],
    ['a backslash in the middle', '/orgs\\..\\evil'],
    ['an https URL', 'https://evil.com'],
    ['an http URL with a path', 'http://evil.com/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a vbscript: URL', 'vbscript:msgbox(1)'],
    ['mixed-case scheme', 'JaVaScRiPt:alert(1)'],
    ['a leading space', ' /ok'],
    ['a trailing space', '/ok '],
    ['a space inside', '/a b'],
    ['a tab', '/a\tb'],
    ['a tab before the second slash', '/\t/evil.com'],
    ['a newline', '/a\nb'],
    ['a carriage return', '/a\rb'],
    ['a NUL', '/a\0b'],
    ['DEL', '/a\x7fb'],
    ['a C1 control', '/a\x85b'],
    ['a line separator', '/a b'],
    ['a no-break space', '/a b'],
    ['a zero-width space after the slash', '/​/evil.com'],
    ['a non-ASCII letter', '/café'],
    ['an encoded double slash', '/%2F%2Fevil.com'],
    ['an encoded double slash, lower case', '/%2f%2fevil.com'],
    ['an encoded backslash', '/%5Cevil.com'],
    ['a malformed percent sequence', '/%E0%A4%A'],
    ['513 characters', `/${'a'.repeat(512)}`],
    ['600 characters', `/${'a'.repeat(599)}`],
    ['the login page (a redirect loop)', '/login'],
    ['the login page with a query', '/login?next=/orgs'],
    ['the login page with a trailing slash', '/login/'],
    ['the signup page', '/signup'],
    ['the signup page with a hash', '/signup#form'],
  ]

  it.each(hostile)('%s', (_label, value) => {
    expect(safeNext(value)).toBe('/')
  })

  it('returns the fallback you give it', () => {
    expect(safeNext('//evil.com', '/home')).toBe('/home')
    expect(safeNext(undefined, '/home')).toBe('/home')
    expect(safeNext('/orgs', '/home')).toBe('/orgs')
  })

  it('never returns anything that resolves off the origin (property check)', () => {
    // Every combination of a few dangerous characters, 1 to 5 long, after a slash.
    const alphabet = ['/', '\\', '%2F', '%5C', '.', ':', '@', 'a', '\t', ' ']
    const origin = 'http://dts.invalid'
    let checked = 0
    const walk = (prefix: string, depth: number) => {
      const candidate = `/${prefix}`
      const result = safeNext(candidate)
      expect(new URL(result, origin).origin, JSON.stringify(candidate)).toBe(
        origin,
      )
      expect(result.startsWith('//'), JSON.stringify(candidate)).toBe(false)
      checked += 1
      if (depth === 0) return
      for (const piece of alphabet) walk(prefix + piece, depth - 1)
    }
    walk('', 4)
    expect(checked).toBeGreaterThan(10_000)
  })
})

describe('loginPathFor', () => {
  it('sends the visitor to /login with the page they wanted, encoded', () => {
    expect(
      loginPathFor({ pathname: '/orgs/1/brands/2', search: '?tab=x&y=1' }),
    ).toBe('/login?next=%2Forgs%2F1%2Fbrands%2F2%3Ftab%3Dx%26y%3D1')
  })

  it('leaves out next when they wanted the home page', () => {
    expect(loginPathFor({ pathname: '/', search: '' })).toBe('/login')
  })

  it('leaves out next when the wanted page is not safe to return to', () => {
    expect(loginPathFor({ pathname: '//evil.com', search: '' })).toBe('/login')
  })

  it('round-trips through safeNext', () => {
    const wanted = { pathname: '/orgs/a b', search: '?q=%2F%2F' }
    const target = loginPathFor(wanted)
    const next = new URL(target, 'http://x.test').searchParams.get('next')
    // a raw space is not a safe character; the router encodes it, so this input
    // is refused rather than returned (and the visitor lands on the home page).
    expect(safeNext(next)).toBe('/')
    const encoded = loginPathFor({ pathname: '/orgs/a%20b', search: '?q=1' })
    const next2 = new URL(encoded, 'http://x.test').searchParams.get('next')
    expect(safeNext(next2)).toBe('/orgs/a%20b?q=1')
  })
})
