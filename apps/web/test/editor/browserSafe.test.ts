import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The editor runs tokens-core in the browser (resolve, toCssVariables, the shared
// row mapper). tokens-core is pure TypeScript by contract; this pins it for the web
// bundle: no Node module may appear in its (non-test) sources.

const SRC = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'tokens-core',
  'src',
)

const sources = readdirSync(SRC, { encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
  .filter((file) => file !== 'testHelpers.ts')
  .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }))

describe('tokens-core is safe to bundle for the browser', () => {
  it('has sources to scan', () => {
    expect(sources.length).toBeGreaterThan(10)
  })

  it.each(sources)('$file imports no Node module', ({ text }) => {
    const specifiers = [
      ...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1] ?? '')
    const nodeLike = specifiers.filter(
      (s) =>
        s.startsWith('node:') ||
        ['fs', 'path', 'crypto', 'buffer', 'os', 'util', 'url'].includes(s),
    )
    expect(nodeLike).toEqual([])
  })

  it.each(sources)('$file uses no Node globals', ({ text }) => {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bBuffer\b/)
    expect(code).not.toMatch(/\bprocess\.(env|cwd|platform|argv)\b/)
    expect(code).not.toMatch(/\brequire\(/)
    expect(code).not.toMatch(/\b__dirname\b/)
  })
})
