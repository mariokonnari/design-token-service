import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Is the BUILT bundle (dist/) at least as new as everything it was built from?
 *
 * `pnpm test:e2e` serves dist/. A forgotten rebuild would test yesterday's code and
 * pass, so the script that runs the browser suite refuses to start on a stale
 * bundle (ADR 0016). "Newer" is strict: a source with exactly the build's time is
 * fine. Inputs: src/, public/, index.html, package.json, vite.config.ts of this
 * app, plus the sources of the two workspace packages the bundle includes
 * (packages/ui/src, packages/ui/tokens, packages/tokens-core/src) when they exist next to it.
 */

export type Freshness = { ok: true } | { ok: false; message: string }

const FILES = ['index.html', 'package.json', 'vite.config.ts']
const DIRECTORIES = ['src', 'public']
const WORKSPACE_DIRECTORIES = [
  ['..', '..', 'packages', 'ui', 'src'],
  // The starter token file is bundled into the editor (ADR 0017).
  ['..', '..', 'packages', 'ui', 'tokens'],
  ['..', '..', 'packages', 'tokens-core', 'src'],
]
const MAX_LISTED = 5

function walk(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

export function checkDistFresh(root: string): Freshness {
  const index = join(root, 'dist', 'index.html')
  if (!existsSync(index)) {
    return {
      ok: false,
      message:
        'dist/index.html is missing: there is no build to test. Build it first: pnpm --filter web build (or run pnpm --filter web test:e2e:build).',
    }
  }
  if (!existsSync(join(root, 'src'))) {
    return {
      ok: false,
      message: `Cannot find src/ in ${root}: wrong directory, nothing to compare the build with.`,
    }
  }
  const builtAt = statSync(index).mtimeMs

  const inputs: string[] = []
  for (const file of FILES) {
    if (existsSync(join(root, file))) inputs.push(join(root, file))
  }
  for (const directory of DIRECTORIES) {
    if (existsSync(join(root, directory)))
      inputs.push(...walk(join(root, directory)))
  }
  for (const parts of WORKSPACE_DIRECTORIES) {
    const directory = join(root, ...parts)
    if (existsSync(directory)) inputs.push(...walk(directory))
  }

  const newer = inputs
    .filter((file) => statSync(file).mtimeMs > builtAt)
    .map((file) => relative(root, file).replaceAll('\\', '/'))
    .sort()
  if (newer.length === 0) return { ok: true }

  const listed = newer.slice(0, MAX_LISTED).join(', ')
  const more =
    newer.length > MAX_LISTED ? ` and ${newer.length - MAX_LISTED} more` : ''
  return {
    ok: false,
    message: `The build in dist/ is stale: older than ${listed}${more}. Rebuild it: pnpm --filter web build (or run pnpm --filter web test:e2e:build). Refusing to run the browser tests against old code.`,
  }
}
