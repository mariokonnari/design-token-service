import { cssVarName } from '@dts/tokens-core'
import { createApp } from './app'
import { createAuthenticate } from './auth/authenticate'
import { createPasswordService } from './auth/password'
import { createRequireOrg } from './auth/requireOrg'
import { createSessionService } from './auth/session'
import { EnvError, parseEnv } from './config/env'
import { createPrismaClient } from './db/client'
import { createReadinessCheck } from './db/ready'
import { createLogger } from './http/logger'
import { DEFAULT_RATE_LIMITS, createRateLimiters } from './http/rateLimit'
import { MembershipLookupRepository } from './repositories/global/memberships'
import { OrganizationRepository } from './repositories/global/organizations'
import { UserRepository } from './repositories/global/users'
import { BrandRepository } from './repositories/brands'
import { PublicReleaseRepository } from './repositories/public/releases'
import { MembershipRepository } from './repositories/memberships'
import { ReleaseRepository } from './repositories/releases'
import { TokenRepository } from './repositories/tokens'
import { buildRouteTable } from './routes/table'

let env: ReturnType<typeof parseEnv>
try {
  env = parseEnv()
} catch (error) {
  console.error(error instanceof EnvError ? error.message : error)
  process.exit(1)
}

const logger = createLogger()

// No database connection is opened here: the Prisma client and the readiness pool
// connect lazily on their first query. The password service only does CPU work
// (one hash, for the dummy used on unknown emails), so the app starts with no DB.
const db = createPrismaClient(env.DATABASE_URL)
const readiness = createReadinessCheck(env.DATABASE_URL)
const users = new UserRepository(db)
const memberships = new MembershipLookupRepository(db)
const passwords = await createPasswordService()
const sessions = createSessionService({
  secret: env.SESSION_SECRET,
  production: env.NODE_ENV === 'production',
})
const limiters = createRateLimiters(DEFAULT_RATE_LIMITS)

const app = createApp({
  config: {
    allowedOrigins: env.ALLOWED_ORIGINS,
    trustProxy: env.TRUST_PROXY,
  },
  logger,
  routes: buildRouteTable({
    checkReady: readiness.check,
    auth: {
      users,
      passwords,
      sessions,
      signupEnabled: env.SIGNUP_ENABLED,
      limiters,
    },
    orgs: {
      organizations: new OrganizationRepository(db),
      lookup: memberships,
      members: new MembershipRepository(db),
    },
    brands: { brands: new BrandRepository(db) },
    tokens: {
      tokens: new TokenRepository(db),
      importLimiter: limiters.tokenImport,
    },
    releases: {
      releases: new ReleaseRepository(db),
      publishLimiter: limiters.publish,
    },
    public: {
      releases: new PublicReleaseRepository(db),
      limiter: limiters.publicRead,
    },
  }),
  guards: {
    authenticate: createAuthenticate({ sessions, users }),
    requireOrg: createRequireOrg({ memberships }),
  },
})

const server = app.listen(env.PORT, () => {
  console.log(
    `api listening on :${env.PORT} [${env.NODE_ENV}] (tokens-core: ${cssVarName('color.blue.500')})`,
  )
})

function shutdown() {
  server.close(() => {
    void Promise.all([readiness.close(), db.$disconnect()]).finally(() => {
      process.exit(0)
    })
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
