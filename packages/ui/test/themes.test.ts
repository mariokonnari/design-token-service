import { readFileSync } from 'node:fs'
import { checkTiers, flatten, resolve } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import {
  GENERATED_CSS_PATH,
  ThemeBuildError,
  buildThemes,
  generateThemesCss,
  loadThemeSources,
  renderThemesCss,
} from '../scripts/lib/buildThemes'

const sources = loadThemeSources()

function declarationsOf(css: string, slug: string): Map<string, string> {
  const start = css.indexOf(`[data-theme="${slug}"] {`)
  if (start === -1) throw new Error(`no block for ${slug}`)
  const end = css.indexOf('\n}\n', start)
  const block = css.slice(start, end)
  const map = new Map<string, string>()
  for (const line of block.split('\n')) {
    const match = /^ {2}(--[a-z0-9-]+): (.*);$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      map.set(match[1], match[2])
    }
  }
  return map
}

describe('token source files', () => {
  it('are discovered with default first, then alphabetically', () => {
    expect(sources.map((source) => source.slug)).toEqual(['default', 'acme'])
  })

  it('each file passes flatten and checkTiers on its own with no error issues', () => {
    for (const { slug, tree } of sources) {
      const flat = flatten(tree)
      const errors = flat.issues.filter((issue) => issue.severity === 'error')
      expect(errors, `${slug}: flatten`).toEqual([])
      expect(
        checkTiers(flat.tokens).filter((issue) => issue.severity === 'error'),
        `${slug}: tiers`,
      ).toEqual([])
    }
  })

  it('the default theme resolves with no issues at all', () => {
    const flat = flatten(sources[0]?.tree)
    const result = resolve(flat.tokens, { rejected: flat.rejected })
    expect(flat.issues).toEqual([])
    expect(result.issues).toEqual([])
    expect(checkTiers(flat.tokens)).toEqual([])
  })

  it('define the minimum the default theme must have', () => {
    const flat = flatten(sources[0]?.tree)
    const paths = new Set(flat.tokens.map((token) => token.path))
    for (const required of [
      'primitive.color.neutral.500',
      'primitive.color.brand.600',
      'primitive.color.red.600',
      'primitive.space.4',
      'primitive.radius.md',
      'primitive.font.family.sans',
      'primitive.font.size.md',
      'primitive.font.weight.bold',
      'semantic.color.surface',
      'semantic.color.text',
      'semantic.color.text-muted',
      'semantic.color.border',
      'semantic.color.action.primary',
      'semantic.color.action.primary-hover',
      'semantic.color.action.on-primary',
      'semantic.color.danger',
      'semantic.color.focus-ring',
      'component.button.bg-primary',
    ]) {
      expect(paths.has(required), required).toBe(true)
    }
  })
})

describe('buildThemes', () => {
  const builds = buildThemes(sources)

  it('builds every theme from the merged tokens with no error issues', () => {
    expect(builds.map((build) => build.slug)).toEqual(['default', 'acme'])
    for (const build of builds) {
      expect(
        build.issues.filter((issue) => issue.severity === 'error'),
      ).toEqual([])
      expect(build.css.startsWith(`[data-theme="${build.slug}"] {\n`)).toBe(
        true,
      )
    }
  })

  it('ships semantic and component tokens only, never primitives', () => {
    for (const build of builds) {
      expect(build.css).not.toContain('--primitive-')
      expect(build.css).toContain('--semantic-color-surface:')
      expect(build.css).toContain('--component-button-bg-primary:')
    }
  })

  it('declares exactly the same variables in every theme', () => {
    const [first, ...rest] = builds.map((build) => [
      ...declarationsOf(build.css, build.slug).keys(),
    ])
    for (const names of rest) expect(names).toEqual(first)
  })

  it('the acme overlay changes the brand-derived values and the radius, and nothing else', () => {
    const css = renderThemesCss(builds)
    const base = declarationsOf(css, 'default')
    const acme = declarationsOf(css, 'acme')
    const changed = [...base.keys()].filter(
      (name) => base.get(name) !== acme.get(name),
    )
    expect(changed.sort()).toEqual(
      [
        '--component-button-bg-primary',
        '--component-button-bg-primary-hover',
        '--component-button-radius',
        '--semantic-color-action-primary',
        '--semantic-color-action-primary-hover',
        '--semantic-color-focus-ring',
        '--semantic-radius-control',
      ].sort(),
    )
    expect(acme.get('--semantic-color-action-primary')).toBe('#7c3aed')
    expect(base.get('--semantic-color-action-primary')).toBe('#2563eb')
    expect(acme.get('--semantic-radius-control')).toBe('12px')
    expect(base.get('--semantic-radius-control')).toBe('6px')
  })

  it('writes a "do not edit" header, no timestamp, and ends with a newline', () => {
    const css = renderThemesCss(builds)
    expect(css.startsWith('/* GENERATED FILE')).toBe(true)
    expect(css).toMatch(/DO NOT EDIT/)
    expect(css).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(css.endsWith('}\n')).toBe(true)
  })
})

describe('buildThemes: failures are readable errors', () => {
  const base = sources[0]?.tree

  function failure(overlay: unknown): ThemeBuildError {
    try {
      buildThemes([
        { slug: 'default', tree: base },
        { slug: 'broken', tree: overlay },
      ])
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeBuildError)
      return error as ThemeBuildError
    }
    throw new Error('expected buildThemes to throw')
  }

  it('reports a tier violation with the theme, code, path and message', () => {
    const error = failure({
      component: {
        button: { 'bg-primary': { $value: '{primitive.color.brand.600}' } },
      },
    })
    expect(error.problems.join('\n')).toMatch(
      /\[broken\] TIER_VIOLATION component\.button\.bg-primary/,
    )
    expect(error.message).toContain('TIER_VIOLATION')
  })

  it('reports an unresolvable alias', () => {
    const error = failure({
      semantic: { color: { surface: { $value: '{primitive.color.nope}' } } },
    })
    expect(error.problems.join('\n')).toMatch(/ALIAS_NOT_FOUND/)
  })

  it('reports an invalid token value', () => {
    const error = failure({
      primitive: {
        color: {
          $type: 'color',
          brand: {
            '600': { $value: { colorSpace: 'srgb', components: [2, 0, 0] } },
          },
        },
      },
    })
    expect(error.problems.join('\n')).toMatch(/INVALID_VALUE/)
  })

  it('reports a merge conflict', () => {
    const error = failure({ primitive: { color: { neutral: { $value: 1 } } } })
    expect(error.problems.join('\n')).toMatch(
      /\[broken\].*primitive\.color\.neutral/,
    )
  })

  it('requires a default theme first', () => {
    expect(() => buildThemes([{ slug: 'acme', tree: {} }])).toThrow(
      ThemeBuildError,
    )
    expect(() => buildThemes([])).toThrow(ThemeBuildError)
  })

  it('rejects a slug that is not a valid name', () => {
    expect(() =>
      buildThemes([
        { slug: 'default', tree: base },
        { slug: 'Bad Slug', tree: {} },
      ]),
    ).toThrow(ThemeBuildError)
  })
})

describe('generated CSS is up to date (drift check)', () => {
  it('src/themes.generated.css equals a fresh in-memory generation', () => {
    const onDisk = readFileSync(GENERATED_CSS_PATH, 'utf8')
    expect(onDisk).toBe(generateThemesCss())
  })
})
