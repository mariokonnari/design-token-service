import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-level guards for the web app. ESLint forbids the HTML-injection APIs
// (eslint.config.mjs); this scan is a second, independent layer that also covers
// the browser-storage rule: no token, session or credential is ever kept in the
// browser by our code (the session is an HttpOnly cookie, ADR 0013 / 0016).

const SRC = join(import.meta.dirname, '..', 'src')

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .sort()
  .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }))

/** Strips comments so a sentence that merely MENTIONS a forbidden API does not count. */
function code(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
}

const HTML_INJECTION =
  /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|\beval\s*\(|new Function\s*\(/
const BROWSER_STORAGE =
  /localStorage|sessionStorage|indexedDB|document\.cookie|cookieStore|caches\.open/

function offenders(pattern: RegExp): string[] {
  return sources
    .filter(({ text }) => pattern.test(code(text)))
    .map(({ file }) => file)
}

describe('source scan', () => {
  it('finds the app sources (so the checks below are not vacuous)', () => {
    expect(sources.length).toBeGreaterThan(15)
    expect(sources.some(({ file }) => file.endsWith('client.ts'))).toBe(true)
  })

  it('no HTML-injection API appears anywhere in src', () => {
    expect(offenders(HTML_INJECTION)).toEqual([])
  })

  it('no browser storage, cookie access or cache API appears anywhere in src', () => {
    expect(offenders(BROWSER_STORAGE)).toEqual([])
  })

  it('the patterns can fail (bad samples)', () => {
    for (const bad of [
      '<div dangerouslySetInnerHTML={{ __html: x }} />',
      'el.innerHTML = x',
      'el.insertAdjacentHTML("beforeend", x)',
      'document.write(x)',
      'eval(x)',
      'new Function(x)',
    ]) {
      expect(HTML_INJECTION.test(code(bad)), bad).toBe(true)
    }
    for (const bad of [
      'localStorage.setItem("t", token)',
      'window.sessionStorage.getItem("t")',
      'document.cookie = "a=b"',
      'indexedDB.open("x")',
    ]) {
      expect(BROWSER_STORAGE.test(code(bad)), bad).toBe(true)
    }
    // comments do not count, code does
    expect(HTML_INJECTION.test(code('// never use innerHTML here'))).toBe(false)
    expect(HTML_INJECTION.test(code('/* dangerouslySetInnerHTML */'))).toBe(
      false,
    )
  })
})
