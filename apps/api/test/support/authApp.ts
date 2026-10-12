import type { Request } from 'express'
import request from 'supertest'
import { createAuthenticate } from '../../src/auth/authenticate'
import {
  createPasswordService,
  defaultDeriveKey,
  type PasswordService,
  type PasswordServiceOptions,
} from '../../src/auth/password'
import { createSessionService } from '../../src/auth/session'
import type { AppConfig } from '../../src/app'
import type { Db } from '../../src/db/client'
import {
  DEFAULT_RATE_LIMITS,
  createRateLimiters,
  type RateLimitConfig,
} from '../../src/http/rateLimit'
import { UserRepository } from '../../src/repositories/global/users'
import { OrganizationRepository } from '../../src/repositories/global/organizations'
import { BrandRepository } from '../../src/repositories/brands'
import { TokenRepository } from '../../src/repositories/tokens'
import type { TxTiming } from '../../src/db/txTiming'
import { MembershipRepository } from '../../src/repositories/memberships'
import { createRequireOrg } from '../../src/auth/requireOrg'
import { MembershipLookupRepository } from '../../src/repositories/global/memberships'
import { appWith, ALLOWED_ORIGIN, testRoute } from './http'
import { buildRouteTable } from '../../src/routes/table'
import type { RouteDef } from '../../src/routes/table'
import { createApp } from '../../src/app'
import { createLogger } from '../../src/http/logger'
import { logCapture, testConfig } from './http'

/** Fast scrypt parameters: the production ones cost ~300 ms per hash. */
export const FAST_SCRYPT = { N: 1024, r: 8, p: 1 }

export const SESSION_SECRET = 'route-test-session-secret-0123456789abcd'

export interface AuthAppOptions {
  signupEnabled?: boolean
  limits?: Partial<{
    [K in keyof Omit<RateLimitConfig, 'keys'>]: Partial<RateLimitConfig[K]>
  }>
  keys?: RateLimitConfig['keys']
  config?: Partial<AppConfig>
  passwords?: PasswordServiceOptions
  extraRoutes?: RouteDef[]
  /** Lock/transaction timing for the draft token repository (tests use tiny values). */
  tokenTiming?: Partial<TxTiming>
  /** A separate client for the token repository (e.g. one with a pool of 1). */
  tokenDb?: Db
}

/** The real app with the real auth routes, repositories and a REAL database. */
export async function authApp(db: Db, options: AuthAppOptions = {}) {
  const derivations = { count: 0 }
  const passwords: PasswordService = await createPasswordService({
    params: FAST_SCRYPT,
    deriveKey: (...args) => {
      derivations.count += 1
      return defaultDeriveKey(...args)
    },
    ...options.passwords,
  })
  const users = new UserRepository(db)
  const memberships = new MembershipLookupRepository(db)
  const sessions = createSessionService({
    secret: SESSION_SECRET,
    production: false,
  })

  const generous = 100_000
  const rule = (name: keyof Omit<RateLimitConfig, 'keys'>) => ({
    windowMs: DEFAULT_RATE_LIMITS[name].windowMs,
    limit: generous,
    ...options.limits?.[name],
  })
  const limiters = createRateLimiters({
    loginAccount: rule('loginAccount'),
    loginIp: rule('loginIp'),
    signup: rule('signup'),
    changePassword: rule('changePassword'),
    tokenImport: rule('tokenImport'),
    ...(options.keys === undefined ? {} : { keys: options.keys }),
  })

  const capture = logCapture()
  const logger = createLogger({ level: 'info', destination: capture.stream })
  const routes: RouteDef[] = [
    ...buildRouteTable({
      checkReady: () => Promise.resolve(true),
      auth: {
        users,
        passwords,
        sessions,
        signupEnabled: options.signupEnabled ?? true,
        limiters,
      },
      orgs: {
        organizations: new OrganizationRepository(db),
        lookup: memberships,
        members: new MembershipRepository(db),
      },
      brands: { brands: new BrandRepository(db) },
      tokens: {
        tokens: new TokenRepository(options.tokenDb ?? db, options.tokenTiming),
        importLimiter: limiters.tokenImport,
      },
    }),
    ...(options.extraRoutes ?? []),
  ]
  const app = createApp({
    config: { ...testConfig, ...options.config },
    logger,
    routes,
    guards: {
      authenticate: createAuthenticate({ sessions, users }),
      requireOrg: createRequireOrg({ memberships }),
    },
  })
  return {
    app,
    capture,
    routes,
    users,
    memberships,
    passwords,
    sessions,
    derivations,
  }
}

/** 
equest(app) and 
equest.agent(app) have the same type. */
type Target = ReturnType<typeof request>

/** POST JSON with the Origin header the CSRF check requires. */
export function post(target: Target, path: string, body?: unknown) {
  const test = target.post(path).set('Origin', ALLOWED_ORIGIN)
  return body === undefined
    ? test
    : test.set('Content-Type', 'application/json').send(body as object)
}

export function patch(target: Target, path: string, body?: unknown) {
  const test = target.patch(path).set('Origin', ALLOWED_ORIGIN)
  return body === undefined
    ? test
    : test.set('Content-Type', 'application/json').send(body as object)
}

export function put(target: Target, path: string, body?: unknown) {
  const test = target.put(path).set('Origin', ALLOWED_ORIGIN)
  return body === undefined
    ? test
    : test.set('Content-Type', 'application/json').send(body as object)
}

export function del(target: Target, path: string) {
  return target.delete(path).set('Origin', ALLOWED_ORIGIN)
}

export const PASSWORD = 'correct horse battery staple'

export async function signUp(
  target: Target,
  email = 'person@example.com',
  password = PASSWORD,
) {
  return post(target, '/api/auth/signup', { email, password })
}

export function setCookies(response: request.Response): string[] {
  return (
    (response.headers['set-cookie'] as unknown as string[] | undefined) ?? []
  )
}

/** The raw session token from a Set-Cookie header (so a test can replay it). */
export function tokenFrom(response: request.Response): string {
  const header =
    setCookies(response).find((c) => c.startsWith('dts_session=')) ?? ''
  return header.slice('dts_session='.length).split(';')[0] ?? ''
}

export const withToken = (token: string) => `dts_session=${token}`

export type { Request }
export { appWith, testRoute }
