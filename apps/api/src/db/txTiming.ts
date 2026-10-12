/**
 * How long a draft mutation may wait, in three nested limits (ADR 0014).
 *
 * Prisma 7's interactive-transaction defaults are `maxWait` 2000 ms (waiting for a
 * pooled connection) and `timeout` 5000 ms (the whole transaction). We set all three
 * explicitly so nothing depends on a default that can change:
 *
 *   lockTimeoutMs  how long to wait for the brand-row lock. Postgres cancels the
 *                  statement (SQLSTATE 55P03) -> the API answers 503 SERVICE_BUSY.
 *   txTimeoutMs    the whole transaction. MUST be larger than lockTimeoutMs: if the
 *                  two were equal, Prisma could abort the transaction first and the
 *                  caller would see a generic transaction error instead of the lock
 *                  error (we map both to 503, but the ordering keeps the cause clear
 *                  and the rollback in Postgres's hands).
 *   maxWaitMs      how long to wait for a free connection to START the transaction
 *                  (Prisma P2028) -> also 503.
 */
export interface TxTiming {
  lockTimeoutMs: number
  txTimeoutMs: number
  maxWaitMs: number
}

export const DEFAULT_TX_TIMING: TxTiming = {
  lockTimeoutMs: 3000,
  txTimeoutMs: 8000,
  maxWaitMs: 3000,
}

/** The seconds a refused client is told to wait (Retry-After). */
export const RETRY_AFTER_SECONDS = 1

export function resolveTxTiming(partial: Partial<TxTiming> = {}): TxTiming {
  const timing = { ...DEFAULT_TX_TIMING, ...partial }
  for (const [name, value] of Object.entries(timing)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer (milliseconds).`)
    }
  }
  if (timing.lockTimeoutMs >= timing.txTimeoutMs) {
    throw new Error(
      `lockTimeoutMs (${timing.lockTimeoutMs}) must be strictly less than txTimeoutMs (${timing.txTimeoutMs}).`,
    )
  }
  return timing
}
