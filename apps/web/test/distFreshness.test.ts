import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkDistFresh } from '../scripts/distFreshness'

// `pnpm test:e2e` serves the BUILT bundle. A forgotten rebuild would test old code
// and pass, so the e2e script refuses to run when the bundle is older than its
// sources. This is the guard's own test, on a throwaway directory.

let root = ''
const SECOND = 1000
const T0 = Date.UTC(2026, 9, 12, 12, 0, 0)

function put(relative: string, mtimeMs: number) {
  const file = join(root, relative)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, 'x')
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
}

/** A project whose sources are older than the build by default. */
function project(overrides: Record<string, number> = {}) {
  const old = T0 - 60 * SECOND
  const sources: Record<string, number> = {
    'src/main.tsx': old,
    'src/pages/Login.tsx': old,
    'index.html': old,
    'package.json': old,
    'vite.config.ts': old,
    'public/favicon.svg': old,
    ...overrides,
  }
  for (const [file, mtime] of Object.entries(sources)) put(file, mtime)
  put('dist/index.html', T0)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dts-fresh-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkDistFresh', () => {
  it('passes when the build is newer than every source', () => {
    project()
    expect(checkDistFresh(root)).toEqual({ ok: true })
  })

  it('passes when a source has exactly the build time (not newer)', () => {
    project({ 'src/main.tsx': T0 })
    expect(checkDistFresh(root)).toEqual({ ok: true })
  })

  it('fails with a clear message when there is no build at all', () => {
    project()
    rmSync(join(root, 'dist'), { recursive: true })
    const result = checkDistFresh(root)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/dist/)
    expect(result.ok === false && result.message).toMatch(/build/i)
  })

  it.each([
    'src/main.tsx',
    'src/pages/Login.tsx',
    'index.html',
    'package.json',
    'vite.config.ts',
    'public/favicon.svg',
  ])('fails when %s is newer than the build, and names it', (file) => {
    project({ [file]: T0 + 5 * SECOND })
    const result = checkDistFresh(root)
    expect(result.ok).toBe(false)
    const message = result.ok === false ? result.message : ''
    expect(message).toContain(file.replaceAll('\\', '/'))
    expect(message).toMatch(/stale|older|rebuild|build/i)
  })

  it('finds a new file deep inside src', () => {
    project()
    put('src/a/b/c/d/Deep.tsx', T0 + SECOND)
    expect(checkDistFresh(root).ok).toBe(false)
  })

  it('ignores node_modules and the build output itself', () => {
    project()
    put('node_modules/pkg/index.js', T0 + 100 * SECOND)
    put('dist/assets/index.js', T0 + 100 * SECOND)
    put('playwright-report/index.html', T0 + 100 * SECOND)
    expect(checkDistFresh(root)).toEqual({ ok: true })
  })

  it('works when optional inputs (public/) do not exist', () => {
    project()
    rmSync(join(root, 'public'), { recursive: true })
    expect(checkDistFresh(root)).toEqual({ ok: true })
  })

  it('fails when the sources themselves are missing (wrong directory)', () => {
    put('dist/index.html', T0)
    const result = checkDistFresh(root)
    expect(result.ok).toBe(false)
  })
})

describe('checkDistFresh: workspace packages the bundle includes', () => {
  // A throwaway monorepo: <tmp>/apps/web is the app, <tmp>/packages/* its siblings.
  let repo = ''
  let app = ''
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'dts-fresh-mono-'))
    app = join(repo, 'apps', 'web')
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  function putIn(base: string, relative: string, mtimeMs: number) {
    const file = join(base, relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'x')
    utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
  }

  function monorepo(extra: Record<string, number> = {}) {
    const old = T0 - 60 * SECOND
    for (const file of [
      'src/main.tsx',
      'index.html',
      'package.json',
      'vite.config.ts',
    ])
      putIn(app, file, old)
    putIn(repo, 'packages/ui/src/index.ts', old)
    putIn(repo, 'packages/ui/tokens/default.tokens.json', old)
    putIn(repo, 'packages/tokens-core/src/index.ts', old)
    for (const [file, mtime] of Object.entries(extra)) putIn(repo, file, mtime)
    putIn(app, 'dist/index.html', T0)
  }

  it('passes when the build is newer than the ui sources and the starter tokens', () => {
    monorepo()
    expect(checkDistFresh(app)).toEqual({ ok: true })
  })

  it.each([
    'packages/ui/src/index.ts',
    'packages/tokens-core/src/index.ts',
    'packages/ui/tokens/default.tokens.json',
  ])(
    'fails when %s is newer than the build (the starter JSON is bundled into the app)',
    (file) => {
      monorepo({ [file]: T0 + 5 * SECOND })
      const result = checkDistFresh(app)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.message).toContain('../../' + file)
    },
  )
})
