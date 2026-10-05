import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkTiers,
  flatten,
  isValidName,
  resolve,
  toCssVariables,
  type Issue,
  type ResolvedToken,
} from '@dts/tokens-core'
import { MergeError, mergeTokenTrees } from './mergeTokens'

/**
 * Builds the theme CSS from the token files (ADR 0008). This lives outside
 * `src` on purpose: the component source must not import tokens-core, but a
 * build script may (ADR 0001).
 */

export const TOKENS_DIR = join(import.meta.dirname, '..', '..', 'tokens')
export const GENERATED_CSS_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'themes.generated.css',
)

const FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.tokens\.json$/

export interface ThemeSource {
  slug: string
  tree: unknown
}

export interface ThemeBuild {
  slug: string
  /** The `[data-theme="slug"] { ... }` block. */
  css: string
  resolved: ResolvedToken[]
  /** Every issue, including warnings. Errors make `buildThemes` throw. */
  issues: Issue[]
}

export class ThemeBuildError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(
      `Theme build failed:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
    )
    this.name = 'ThemeBuildError'
    this.problems = problems
  }
}

export function formatIssue(slug: string, issue: Issue): string {
  const path = issue.path === '' ? '(root)' : issue.path
  const field = issue.field === undefined ? '' : ` (${issue.field})`
  return `[${slug}] ${issue.code} ${path}${field}: ${issue.message}`
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.code,
      issue.path,
      issue.field,
      issue.message,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Builds every theme. The first source must be `default` (the complete base);
 * the others are overlays merged onto it. Each overlay is also checked on its
 * own. Any error-severity issue throws a {@link ThemeBuildError}.
 */
export function buildThemes(sources: readonly ThemeSource[]): ThemeBuild[] {
  const problems: string[] = []
  const [base] = sources
  if (base?.slug !== 'default') {
    throw new ThemeBuildError([
      'the first theme must be "default", the complete base the others overlay',
    ])
  }

  const builds: ThemeBuild[] = []
  for (const source of sources) {
    const { slug } = source
    if (!isValidName(slug)) {
      problems.push(
        `[${String(slug)}] INVALID_NAME the theme slug is not a valid name`,
      )
      continue
    }

    let merged: unknown = source.tree
    const issues: Issue[] = []
    if (source !== base) {
      try {
        merged = mergeTokenTrees(base.tree, source.tree)
      } catch (error) {
        if (!(error instanceof MergeError)) throw error
        problems.push(`[${slug}] MERGE_CONFLICT ${error.message}`)
        continue
      }
      const alone = flatten(source.tree)
      issues.push(...alone.issues, ...checkTiers(alone.tokens))
    }

    const flat = flatten(merged)
    const result = resolve(flat.tokens, { rejected: flat.rejected })
    const css = toCssVariables(result.resolved, {
      scope: { kind: 'attribute', name: 'data-theme', value: slug },
      include: ['semantic', 'component'],
    })
    issues.push(
      ...flat.issues,
      ...result.issues,
      ...checkTiers(flat.tokens),
      ...css.issues,
    )

    const unique = dedupe(issues)
    for (const issue of unique) {
      if (issue.severity === 'error') problems.push(formatIssue(slug, issue))
    }
    if (css.css === '') {
      problems.push(
        `[${slug}] NO_OUTPUT no semantic or component tokens were exported`,
      )
    }
    builds.push({
      slug,
      css: css.css,
      resolved: result.resolved,
      issues: unique,
    })
  }

  if (problems.length > 0) throw new ThemeBuildError(problems)
  return builds
}

const HEADER = `/* GENERATED FILE - DO NOT EDIT.
 * Source: packages/ui/tokens/*.tokens.json, built with @dts/tokens-core
 * (flatten, resolve, checkTiers, toCssVariables).
 * Regenerate with: pnpm generate:theme
 */
`

/** The contents of \`src/themes.generated.css\`. Deterministic: no timestamps. */
export function renderThemesCss(builds: readonly ThemeBuild[]): string {
  return `${HEADER}\n${builds.map((build) => build.css).join('\n')}`
}

/** Reads `<slug>.tokens.json` files: `default` first, then the rest alphabetically. */
export function loadThemeSources(dir: string = TOKENS_DIR): ThemeSource[] {
  const slugs = readdirSync(dir)
    .map((file) => FILE_PATTERN.exec(file)?.[1])
    .filter((slug): slug is string => slug !== undefined)
    .sort((a, b) =>
      a === 'default' ? -1 : b === 'default' ? 1 : a < b ? -1 : a > b ? 1 : 0,
    )

  return slugs.map((slug) => {
    const file = join(dir, `${slug}.tokens.json`)
    try {
      return { slug, tree: JSON.parse(readFileSync(file, 'utf8')) as unknown }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ThemeBuildError([`${file}: could not read as JSON: ${reason}`])
    }
  })
}

export function generateThemesCss(dir: string = TOKENS_DIR): string {
  return renderThemesCss(buildThemes(loadThemeSources(dir)))
}
