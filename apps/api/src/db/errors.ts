import { Prisma } from '../generated/prisma/client'
import { ServiceBusyError } from '../errors'
import { RETRY_AFTER_SECONDS } from './txTiming'

/**
 * Turns the database errors that mean "too busy right now" into one typed 503, so a
 * held lock or a saturated pool is never a 500:
 *  - Prisma P2028: the interactive transaction could not start in time (maxWait) or
 *    ran past its timeout;
 *  - Postgres 55P03 (lock_not_available): `lock_timeout` expired while waiting for
 *    the brand-row lock. Prisma wraps it differently depending on the path, so the
 *    cause chain is searched for the SQLSTATE and for the message Postgres uses.
 * Anything else is returned unchanged.
 */
export function busyOrOriginal(error: unknown): unknown {
  return isBusy(error)
    ? new ServiceBusyError(
        'The brand is being changed by someone else. Try again shortly.',
        'SERVICE_BUSY',
        RETRY_AFTER_SECONDS,
      )
    : error
}

function isBusy(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  ) {
    return true
  }
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null) return false
    if (seen.has(value) || depth > 6) return false
    seen.add(value)
    const record = value as Record<string, unknown>
    if (record['code'] === '55P03' || record['code'] === 'P2028') return true
    if (record['sqlState'] === '55P03' || record['kind'] === 'LockNotAvailable')
      return true
    const message = record['message']
    if (
      typeof message === 'string' &&
      /lock timeout|lock_not_available|could not obtain lock/i.test(message)
    ) {
      return true
    }
    return ['cause', 'meta', 'driverAdapterError', 'originalError'].some(
      (key) => visit(record[key], depth + 1),
    )
  }
  return visit(error, 0)
}

/**
 * True when `error` is a unique-constraint violation: Prisma P2002 from the query
 * builder, or Postgres SQLSTATE 23505 (raw queries wrap it as P2010 with the SQLSTATE
 * in `meta`, the driver adapter may nest it in `cause`). Used for the backstop that
 * turns a duplicate (brandId, number) into a 409 instead of a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return true
  }
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null) return false
    if (seen.has(value) || depth > 6) return false
    seen.add(value)
    const record = value as Record<string, unknown>
    if (record['code'] === '23505' || record['sqlState'] === '23505') {
      return true
    }
    return ['cause', 'meta', 'driverAdapterError', 'originalError'].some(
      (key) => visit(record[key], depth + 1),
    )
  }
  return visit(error, 0)
}
