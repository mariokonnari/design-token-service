import { defineConfig, env } from 'prisma/config'

// Prisma 7 does not load .env files itself. This file only runs for the Prisma CLI
// (migrate, generate, studio), never in the API at runtime, so it is fine to read
// a local .env here with Node's built-in loader. Variables that are already set
// (CI, your shell) win over the file; a missing file is fine.
try {
  process.loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

// `prisma generate` never connects, but the config still has to evaluate. Give it a
// placeholder ONLY for that command so a fresh clone and the CI install (which run
// generate from `postinstall`) work without a database URL. Every other command
// (migrate, studio) requires the real DATABASE_URL and fails without it.
const GENERATE_PLACEHOLDER_URL =
  'postgresql://placeholder:placeholder@localhost:1/placeholder'
const isGenerate = process.argv.includes('generate')

// `migrate dev` and `migrate diff --from-migrations` replay the migrations in a
// SHADOW database that Prisma wipes, so its name must never be a real database.
// It is `<database>_shadow` on the same server unless SHADOW_DATABASE_URL is set.
// scripts/with-shadow-db.mjs creates it on demand.
function shadowUrl(url: string | undefined): string | undefined {
  const explicit = process.env['SHADOW_DATABASE_URL']
  if (explicit) return explicit
  if (!url) return undefined
  const shadow = new URL(url)
  shadow.pathname = `${shadow.pathname}_shadow`
  return shadow.toString()
}

const databaseUrl = process.env['DATABASE_URL']

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: isGenerate
      ? (databaseUrl ?? GENERATE_PLACEHOLDER_URL)
      : env('DATABASE_URL'),
    shadowDatabaseUrl: shadowUrl(databaseUrl),
  },
})
