import type { RequestHandler, Response } from 'express'
import { UnauthenticatedError } from '../errors'
import type { UserRepository } from '../repositories/global/users'
import type { SessionService } from './session'

export interface AuthContext {
  userId: string
  email: string
  sessionVersion: number
  createdAt: Date
}

export interface AuthenticateDeps {
  sessions: SessionService
  users: Pick<UserRepository, 'findById'>
}

/**
 * The `authenticated` guard. On EVERY request: read the cookie, verify the JWT,
 * LOAD the user and compare the token's session version with the stored one (so
 * logout-all, a password change or a deleted account revoke a session instantly).
 * Any failure is the same 401 with a generic body and a cleared cookie: it never
 * says why. A database error is NOT a 401: it propagates as a 500.
 */
export function createAuthenticate({
  sessions,
  users,
}: AuthenticateDeps): RequestHandler {
  return async function authenticate(req, res, next) {
    try {
      const token = sessions.readToken(req)
      const claims = token === undefined ? null : await sessions.verify(token)
      const user = claims === null ? null : await users.findById(claims.userId)
      if (
        claims === null ||
        user === null ||
        user.sessionVersion !== claims.sessionVersion
      ) {
        sessions.clearCookie(res)
        next(new UnauthenticatedError())
        return
      }
      const auth: AuthContext = {
        userId: user.id,
        email: user.email,
        sessionVersion: user.sessionVersion,
        createdAt: user.createdAt,
      }
      res.locals['auth'] = auth
      next()
    } catch (error) {
      next(error)
    }
  }
}

/** The authenticated user. Throws if the route did not run `authenticate` first. */
export function getAuth(res: Response): AuthContext {
  const auth = res.locals['auth'] as AuthContext | undefined
  if (auth === undefined) {
    throw new Error(
      'getAuth was called on a route that did not run authenticate (check its access in the route table).',
    )
  }
  return auth
}
