import type { Request, RequestHandler, Response } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { normalizeEmail } from '../auth/email'
import { RateLimitedError } from '../errors'

/**
 * Rate limiting (express-rate-limit, IN-MEMORY: counters are per process and are
 * lost on restart; with several instances the limits are per instance. ADR 0013).
 *
 * Every limiter runs BEFORE any password hashing, so a blocked attempt costs no CPU
 * or memory. Login has two:
 * - loginAccount: per IP + email, counting only FAILED attempts (a legitimate user
 *   who logs in successfully is never locked out by it);
 * - loginIp: per IP, counting ALL attempts, looser, so rotating emails from one
 *   address still hits a ceiling.
 *
 * THE PROXY PITFALL: `req.ip` is only the real client if TRUST_PROXY matches the
 * number of proxies in front of the app. Too low and every user shares the proxy's
 * address (one bad actor blocks everyone); too high and a client can forge
 * X-Forwarded-For to dodge the limit. IPv6 addresses are masked to a /56 so an
 * attacker cannot rotate the low bits of one network.
 */

export interface RateLimitRule {
  windowMs: number
  limit: number
}

export interface RateLimitKeys {
  /** Identifies the client. Default: req.ip, IPv6 masked to a /56. */
  ip?: (req: Request) => string
  /** Identifies the attacked account on login. Default: the normalized email in the body. */
  account?: (req: Request) => string
  /** Identifies the logged-in user. Default: the user id set by `authenticate`. */
  user?: (req: Request, res: Response) => string
}

export interface RateLimitConfig {
  loginAccount: RateLimitRule
  loginIp: RateLimitRule
  signup: RateLimitRule
  changePassword: RateLimitRule
  /** Per user; bulk token import. */
  tokenImport: RateLimitRule
  keys?: RateLimitKeys
}

const MINUTE = 60_000

export const DEFAULT_RATE_LIMITS = {
  loginAccount: { windowMs: 15 * MINUTE, limit: 10 },
  loginIp: { windowMs: 15 * MINUTE, limit: 60 },
  signup: { windowMs: 60 * MINUTE, limit: 5 },
  changePassword: { windowMs: 15 * MINUTE, limit: 5 },
  tokenImport: { windowMs: 10 * MINUTE, limit: 10 },
} as const satisfies Omit<RateLimitConfig, 'keys'>

export interface RateLimiters {
  loginAccount: RequestHandler
  loginIp: RequestHandler
  signup: RequestHandler
  changePassword: RequestHandler
  tokenImport: RequestHandler
}

const MAX_EMAIL_KEY = 254

function defaultIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '')
}

function defaultAccountKey(req: Request, ip: string): string {
  const body = req.body as { email?: unknown } | undefined
  const email =
    typeof body?.email === 'string'
      ? normalizeEmail(body.email).slice(0, MAX_EMAIL_KEY)
      : ''
  return `${ip}|${email}`
}

export function createRateLimiters(config: RateLimitConfig): RateLimiters {
  const ipKey = config.keys?.ip ?? defaultIpKey

  function limiter(
    rule: RateLimitRule,
    keyGenerator: (req: Request, res: Response) => string,
    extra: { skipSuccessfulRequests?: boolean } = {},
  ): RequestHandler {
    return rateLimit({
      windowMs: rule.windowMs,
      limit: rule.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator,
      handler: (_req, _res, next) => {
        next(new RateLimitedError())
      },
      ...extra,
    })
  }

  return {
    loginAccount: limiter(
      config.loginAccount,
      (req) =>
        config.keys?.account?.(req) ?? defaultAccountKey(req, ipKey(req)),
      { skipSuccessfulRequests: true },
    ),
    loginIp: limiter(config.loginIp, (req) => ipKey(req)),
    signup: limiter(config.signup, (req) => ipKey(req)),
    changePassword: limiter(
      config.changePassword,
      (req, res) =>
        config.keys?.user?.(req, res) ??
        `user:${(res.locals['auth'] as { userId?: string } | undefined)?.userId ?? ipKey(req)}`,
    ),
    // Runs AFTER authentication and BEFORE the 512 KB body is read or parsed.
    tokenImport: limiter(
      config.tokenImport,
      (req, res) =>
        config.keys?.user?.(req, res) ??
        `user:${(res.locals['auth'] as { userId?: string } | undefined)?.userId ?? ipKey(req)}`,
    ),
  }
}
