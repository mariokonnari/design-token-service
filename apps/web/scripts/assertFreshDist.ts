import { fileURLToPath } from 'node:url'
import { checkDistFresh } from './distFreshness.ts'

// Run by `pnpm test:e2e` before Playwright (Node strips the types; ADR 0016).
const root = fileURLToPath(new URL('..', import.meta.url))
const result = checkDistFresh(root)
if (!result.ok) {
  console.error(`\n${result.message}\n`)
  process.exit(1)
}
console.log('dist/ is up to date with its sources.')
