import { describe, expect, it } from 'vitest'
import { busyOrOriginal } from '../../src/db/errors'
import {
  DEFAULT_TX_TIMING,
  RETRY_AFTER_SECONDS,
  resolveTxTiming,
} from '../../src/db/txTiming'
import { ConflictError, ServiceBusyError } from '../../src/errors'
import { Prisma } from '../../src/generated/prisma/client'
import { TokenRepository } from '../../src/repositories/tokens'

// The three waiting limits of a draft mutation (ADR 0014): lock_timeout < the
// transaction timeout, and both busy signals become the same 503.

describe('transaction timing', () => {
  it('the defaults are explicit and lockTimeoutMs < txTimeoutMs', () => {
    expect(DEFAULT_TX_TIMING).toEqual({
      lockTimeoutMs: 3000,
      txTimeoutMs: 8000,
      maxWaitMs: 3000,
    })
    expect(DEFAULT_TX_TIMING.lockTimeoutMs).toBeLessThan(
      DEFAULT_TX_TIMING.txTimeoutMs,
    )
    expect(resolveTxTiming()).toEqual(DEFAULT_TX_TIMING)
  })

  it.each([
    [{ lockTimeoutMs: 5000, txTimeoutMs: 5000 }], // equal: Prisma may abort first
    [{ lockTimeoutMs: 6000, txTimeoutMs: 5000 }],
    [{ lockTimeoutMs: 8000 }], // equal to the default txTimeoutMs
  ])('refuses a lock timeout that is not strictly smaller: %j', (partial) => {
    expect(() => resolveTxTiming(partial)).toThrow(/strictly less/)
  })

  it.each([
    [{ lockTimeoutMs: 0 }],
    [{ lockTimeoutMs: -1 }],
    [{ txTimeoutMs: 1.5 }],
    [{ maxWaitMs: 0 }],
    [{ maxWaitMs: Number.NaN }],
  ])('refuses a non-positive or fractional value: %j', (partial) => {
    expect(() => resolveTxTiming(partial)).toThrow(/positive integer/)
  })

  it('the repository fails at construction with a bad timing (not at the first request)', () => {
    expect(
      () =>
        new TokenRepository({} as never, {
          lockTimeoutMs: 100,
          txTimeoutMs: 100,
        }),
    ).toThrow(/strictly less/)
  })
})

describe('busyOrOriginal', () => {
  const known = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test',
    })

  it('Prisma P2028 (maxWait / transaction timeout) becomes a 503 SERVICE_BUSY with Retry-After', () => {
    const mapped = busyOrOriginal(known('P2028'))
    expect(mapped).toBeInstanceOf(ServiceBusyError)
    expect(mapped).toMatchObject({
      status: 503,
      code: 'SERVICE_BUSY',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    })
  })

  it.each([
    ['SQLSTATE in code', Object.assign(new Error('x'), { code: '55P03' })],
    [
      'SQLSTATE in a nested cause',
      new Error('wrapper', {
        cause: { cause: Object.assign(new Error('x'), { code: '55P03' }) },
      }),
    ],
    [
      'the message Postgres uses',
      new Error('canceling statement due to lock timeout'),
    ],
    ['Prisma meta', Object.assign(new Error('x'), { meta: { code: '55P03' } })],
  ])('Postgres 55P03 (%s) becomes the same 503', (_label, error) => {
    expect(busyOrOriginal(error)).toBeInstanceOf(ServiceBusyError)
  })

  it('anything else is returned UNCHANGED (a conflict stays a conflict, an unknown error stays unknown)', () => {
    const conflict = new ConflictError()
    const other = new Error('something else')
    const unique = known('P2002')
    expect(busyOrOriginal(conflict)).toBe(conflict)
    expect(busyOrOriginal(other)).toBe(other)
    expect(busyOrOriginal(unique)).toBe(unique)
    expect(busyOrOriginal(undefined)).toBeUndefined()
    expect(busyOrOriginal('text')).toBe('text')
  })

  it('a cyclic cause chain does not hang', () => {
    const a: Record<string, unknown> = { message: 'a' }
    a['cause'] = a
    expect(busyOrOriginal(a)).toBe(a)
  })
})
