import { parseCookie } from 'cookie'
import type { Request, Response } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { isUuid } from '../ids'

/**
 * Sessions: an HS256 JWT in an HttpOnly cookie, verified against the database on
 * every request (`sv` must equal the user's current sessionVersion: logout-all and
 * a password change bump it, which revokes every token at once).
 *
 * Claims: sub (user id), sv, iat, exp (7 days), iss, aud. Verification pins the
 * algorithm to HS256, requires every claim, and returns null (never throws) for
 * anything else. A single signing secret with no rotation: ADR 0013.
 */

export const SESSION_ISSUER = 'dts-api'
export const SESSION_AUDIENCE = 'dts-web'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

const COOKIE_NAME = 'dts_session'
/** `__Host-` makes the browser require Secure + Path=/ + no Domain, so a subdomain cannot plant it. */
const PRODUCTION_COOKIE_NAME = `__Host-${COOKIE_NAME}`
const MAX_TOKEN_LENGTH = 1024
const FUTURE_SKEW_SECONDS = 60

export interface SessionClaims {
  userId: string
  sessionVersion: number
}

export interface SessionService {
  readonly cookieName: string
  sign: (userId: string, sessionVersion: number) => Promise<string>
  /** The claims of a valid token, or null for ANY problem. */
  verify: (token: unknown) => Promise<SessionClaims | null>
  setCookie: (res: Response, token: string) => void
  clearCookie: (res: Response) => void
  /** The token from the Cookie header, or undefined (also when the cookie appears twice). */
  readToken: (req: Request) => string | undefined
}

export interface SessionOptions {
  /** SESSION_SECRET (at least 32 characters, enforced by the env schema). */
  secret: string
  /** Production uses the `__Host-` prefix and the Secure flag; development does not (plain HTTP). */
  production: boolean
  now?: () => Date
}

export function createSessionService({
  secret,
  production,
  now = () => new Date(),
}: SessionOptions): SessionService {
  const key = new TextEncoder().encode(secret)
  const cookieName = production ? PRODUCTION_COOKIE_NAME : COOKIE_NAME
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
  } as const

  return {
    cookieName,

    async sign(userId, sessionVersion) {
      const issuedAt = Math.floor(now().getTime() / 1000)
      return new SignJWT({ sv: sessionVersion })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(SESSION_ISSUER)
        .setAudience(SESSION_AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
        .sign(key)
    },

    async verify(token) {
      if (
        typeof token !== 'string' ||
        token.length === 0 ||
        token.length > MAX_TOKEN_LENGTH
      ) {
        return null
      }
      try {
        const current = now()
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: SESSION_ISSUER,
          audience: SESSION_AUDIENCE,
          requiredClaims: ['sub', 'sv', 'iat', 'exp'],
          currentDate: current,
        })
        const { sub, sv, iat, exp } = payload
        const nowSeconds = Math.floor(current.getTime() / 1000)
        if (
          typeof sub !== 'string' ||
          !isUuid(sub) ||
          typeof sv !== 'number' ||
          !Number.isInteger(sv) ||
          sv < 0 ||
          typeof iat !== 'number' ||
          typeof exp !== 'number' ||
          iat > nowSeconds + FUTURE_SKEW_SECONDS ||
          exp - iat > SESSION_TTL_SECONDS
        ) {
          return null
        }
        return { userId: sub, sessionVersion: sv }
      } catch {
        return null
      }
    },

    setCookie(res, token) {
      res.cookie(cookieName, token, {
        ...cookieOptions,
        maxAge: SESSION_TTL_SECONDS * 1000,
      })
    },

    clearCookie(res) {
      // Same attributes as setCookie: a __Host- cookie can only be removed by a Secure header.
      res.clearCookie(cookieName, cookieOptions)
    },

    readToken(req) {
      const header = req.headers.cookie
      if (typeof header !== 'string') return undefined
      // Two cookies with our name (cookie tossing) are ambiguous: treat as no session.
      const occurrences = header
        .split(';')
        .filter((part) => part.trim().startsWith(`${cookieName}=`)).length
      if (occurrences !== 1) return undefined
      try {
        const value = parseCookie(header)[cookieName]
        return typeof value === 'string' && value !== '' ? value : undefined
      } catch {
        return undefined
      }
    },
  }
}
