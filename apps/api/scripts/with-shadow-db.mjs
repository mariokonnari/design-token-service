// Runs a Prisma CLI command that needs a shadow database (migrate dev, migrate
// diff --from-migrations) after making sure that database exists:
//   node scripts/with-shadow-db.mjs migrate diff --from-migrations ...
// The shadow database is `<DATABASE_URL's database>_shadow` (see prisma.config.ts)
// and Prisma WIPES it, so this script refuses any name that does not end in
// `_shadow`.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import pg from 'pg'

try {
  process.loadEnvFile('.env')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set (put it in apps/api/.env or the environment).',
  )
  process.exit(1)
}

const shadowUrl = new URL(process.env.SHADOW_DATABASE_URL ?? databaseUrl)
if (!process.env.SHADOW_DATABASE_URL) shadowUrl.pathname += '_shadow'
const shadowName = decodeURIComponent(shadowUrl.pathname.slice(1))
if (!/^[a-z0-9_]+_shadow$/.test(shadowName)) {
  console.error(
    `Refusing to use "${shadowName}" as the shadow database: Prisma wipes it, so the name must end in "_shadow".`,
  )
  process.exit(1)
}

const admin = new pg.Client({
  connectionString: Object.assign(new URL(shadowUrl), {
    pathname: '/postgres',
  }).toString(),
  connectionTimeoutMillis: 3000,
})
try {
  await admin.connect()
} catch (error) {
  console.error(
    `Postgres is not reachable at ${shadowUrl.host} (${error.code ?? 'unknown error'}). Run \`pnpm db:up\` first.`,
  )
  process.exit(1)
}
try {
  const found = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [shadowName],
  )
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${shadowName}"`)
} finally {
  await admin.end()
}

const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js')
try {
  execFileSync(process.execPath, [prisma, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
} catch (error) {
  process.exit(error.status ?? 1)
}
