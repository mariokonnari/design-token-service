import { z } from 'zod'
import { getAuth } from '../auth/authenticate'
import { validatePasswordPolicy, type PasswordService } from '../auth/password'
import type { SessionService } from '../auth/session'
import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '../errors'
import type { RateLimiters } from '../http/rateLimit'
import type { UserRecord, UserRepository } from '../repositories/global/users'
import type { RouteDef } from './table'
import { parse, parseEmptyBody } from './validate'

export interface AuthRouteDeps {
  users: UserRepository
  passwords: PasswordService
  sessions: SessionService
  signupEnabled: boolean
  limiters: RateLimiters
}

const MAX_EMAIL = 254
const MAX_PASSWORD_INPUT = 4096

// Signup validates the email format. Login does not: a malformed address is just
// an unknown one (same generic 401, same cost), so the rules are not revealed.
const signupBody = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL)),
  password: z.string(),
})

const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(MAX_EMAIL),
  password: z.string().min(1).max(MAX_PASSWORD_INPUT),
})

const changePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_INPUT),
  newPassword: z.string(),
})

/** What the API says about a user: never the hash, never the session version. */
function userView(user: Pick<UserRecord, 'id' | 'email' | 'createdAt'>) {
  return { id: user.id, email: user.email, createdAt: user.createdAt }
}

export function authRoutes({
  users,
  passwords,
  sessions,
  signupEnabled,
  limiters,
}: AuthRouteDeps): RouteDef[] {
  return [
    {
      method: 'post',
      path: '/api/auth/signup',
      access: 'public',
      before: [limiters.signup],
      handler: async (req, res) => {
        // Checked first: a disabled signup must cost nothing.
        if (!signupEnabled) {
          throw new ForbiddenError(
            'Sign-up is currently disabled.',
            'SIGNUP_DISABLED',
          )
        }
        const { email, password } = parse(signupBody, req.body)
        const problem = validatePasswordPolicy(password)
        if (problem !== null) throw new ValidationError(problem)

        const passwordHash = await passwords.hash(password)
        // The unique constraint decides a race between two signups for one email:
        // the loser gets a 409, never a 500.
        const user = await users.create({ email, passwordHash })
        sessions.setCookie(
          res,
          await sessions.sign(user.id, user.sessionVersion),
        )
        res.status(201).json({ user: userView(user) })
      },
    },

    {
      method: 'post',
      path: '/api/auth/login',
      access: 'public',
      // Both limiters run before any hashing, the per-IP one first.
      before: [limiters.loginIp, limiters.loginAccount],
      handler: async (req, res) => {
        const { email, password } = parse(loginBody, req.body)
        const user = await users.findByEmail(email)

        // ALWAYS exactly one hash, known email or not, so response time does not
        // reveal whether the account exists.
        let valid = false
        if (user === null) {
          await passwords.verifyDummy(password)
        } else {
          valid = await passwords.verify(password, user.passwordHash)
        }
        if (user === null || !valid) {
          throw new UnauthenticatedError(
            'Invalid email or password.',
            'INVALID_CREDENTIALS',
          )
        }

        // Upgrade an old hash to the current parameters. This does NOT bump the
        // session version (other sessions stay valid) and never fails the login.
        if (passwords.needsRehash(user.passwordHash)) {
          try {
            const upgraded = await passwords.hash(password)
            await users.rehashPassword(user.id, user.passwordHash, upgraded)
          } catch (error) {
            req.log.warn({ err: error }, 'could not upgrade the password hash')
          }
        }

        sessions.setCookie(
          res,
          await sessions.sign(user.id, user.sessionVersion),
        )
        res.json({ user: userView(user) })
      },
    },

    {
      // Public on purpose: it only clears the caller's own cookie. NOTE (a
      // documented gap): it does not revoke the token; only logout-all and a
      // password change do.
      method: 'post',
      path: '/api/auth/logout',
      access: 'public',
      handler: (req, res) => {
        parseEmptyBody(req.body)
        sessions.clearCookie(res)
        res.status(204).end()
      },
    },

    {
      method: 'post',
      path: '/api/auth/logout-all',
      access: 'authenticated',
      handler: async (req, res) => {
        parseEmptyBody(req.body)
        await users.bumpSessionVersion(getAuth(res).userId)
        sessions.clearCookie(res)
        res.status(204).end()
      },
    },

    {
      method: 'get',
      path: '/api/me',
      access: 'authenticated',
      handler: (_req, res) => {
        const auth = getAuth(res)
        res.json({
          user: userView({
            id: auth.userId,
            email: auth.email,
            createdAt: auth.createdAt,
          }),
        })
      },
    },

    {
      method: 'post',
      path: '/api/auth/change-password',
      access: 'authenticated',
      after: [limiters.changePassword],
      handler: async (req, res) => {
        const { currentPassword, newPassword } = parse(
          changePasswordBody,
          req.body,
        )
        const auth = getAuth(res)
        const problem = validatePasswordPolicy(newPassword)
        if (problem !== null) throw new ValidationError(problem)
        if (newPassword === currentPassword) {
          throw new ValidationError(
            'The new password must be different from the current one.',
          )
        }

        const user = await users.findByEmail(auth.email)
        if (
          user === null ||
          !(await passwords.verify(currentPassword, user.passwordHash))
        ) {
          throw new ForbiddenError(
            'The current password is incorrect.',
            'INVALID_CURRENT_PASSWORD',
          )
        }

        const newHash = await passwords.hash(newPassword)
        // One statement replaces the hash AND bumps the session version: every
        // other session is revoked; this one gets a fresh cookie below.
        const version = await users.setPasswordHash(user.id, newHash)
        if (version === null) throw new UnauthenticatedError()
        sessions.setCookie(res, await sessions.sign(user.id, version))
        res.status(204).end()
      },
    },
  ]
}
