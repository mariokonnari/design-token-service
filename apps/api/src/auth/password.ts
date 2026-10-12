import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { ServiceBusyError } from '../errors'

/**
 * Password hashing with scrypt (Node's crypto, asynchronous so the event loop is
 * not blocked). Parameters follow OWASP's scrypt guidance: N=2^16 (64 MiB), r=8, p=2.
 * Measured on a developer machine: ~285 ms per hash; memory per CONCURRENT hash is
 * exactly 64 MiB, which is why hashing is capped at 2 at a time with a bounded queue
 * (a small server has 512 MB). Not load-tested on the real server: ADR 0013.
 *
 * Stored format (self-describing, so parameters can change later):
 *   scrypt$N=65536,r=8,p=2$<salt, base64url>$<key, base64url>
 */

export interface ScryptParams {
  N: number
  r: number
  p: number
}

export const PRODUCTION_SCRYPT: ScryptParams = { N: 65536, r: 8, p: 2 }

const KEY_LENGTH = 32
const SALT_LENGTH = 16

// Bounds applied to every STORED hash before it is used, so a tampered string can
// never make the server allocate gigabytes or burn minutes of CPU.
const MIN_N = 1 << 10
const MAX_N = 1 << 17
const MAX_R = 16
const MAX_P = 16
const MAX_N_TIMES_R = 1 << 20 // 128 MiB per hash

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128
/** A longer input is refused before it is normalized or hashed. */
const MAX_INPUT_LENGTH = 4096

const HASH_FORMAT =
  /^scrypt\$N=(\d{1,7}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/

export type DeriveKey = (
  password: string,
  salt: Buffer,
  keyLength: number,
  params: ScryptParams,
) => Promise<Buffer>

export const defaultDeriveKey: DeriveKey = (
  password,
  salt,
  keyLength,
  { N, r, p },
) =>
  new Promise((resolve, reject) => {
    // Node's default maxmem (32 MiB) rejects N=2^16, so it is set from the parameters.
    const maxmem = Math.ceil(128 * N * r * 1.25) + 1_048_576
    scryptCallback(
      password,
      salt,
      keyLength,
      { N, r, p, maxmem },
      (error, key) => {
        if (error) reject(error)
        else resolve(key)
      },
    )
  })

/** NFKC, as NIST SP 800-63B recommends, so equivalent Unicode spellings match. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC')
}

/** Length 12 to 128 characters (code points, after normalization). No composition rules. */
export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== 'string') return 'The password must be a string.'
  if (password.length > MAX_INPUT_LENGTH) {
    return `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  const length = [...normalizePassword(password)].length
  if (length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  return null
}

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

function parseHash(stored: unknown): ParsedHash | null {
  if (typeof stored !== 'string' || stored.length > 200) return null
  const match = HASH_FORMAT.exec(stored)
  if (match === null) return null
  const N = Number(match[1])
  const r = Number(match[2])
  const p = Number(match[3])
  const powerOfTwo = Number.isInteger(N) && N > 0 && (N & (N - 1)) === 0
  if (
    !powerOfTwo ||
    N < MIN_N ||
    N > MAX_N ||
    r < 1 ||
    r > MAX_R ||
    p < 1 ||
    p > MAX_P ||
    N * r > MAX_N_TIMES_R
  ) {
    return null
  }
  const saltText = match[4] ?? ''
  const keyText = match[5] ?? ''
  const salt = Buffer.from(saltText, 'base64url')
  const key = Buffer.from(keyText, 'base64url')
  // Reject non-canonical encodings (stray trailing bits).
  if (
    salt.length !== SALT_LENGTH ||
    key.length !== KEY_LENGTH ||
    salt.toString('base64url') !== saltText ||
    key.toString('base64url') !== keyText
  ) {
    return null
  }
  return { params: { N, r, p }, salt, key }
}

function encode({ N, r, p }: ScryptParams, salt: Buffer, key: Buffer): string {
  return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export interface Limiter {
  run: <T>(task: () => Promise<T>) => Promise<T>
}

/**
 * At most `concurrency` tasks run at once; up to `maxQueue` more wait in order;
 * beyond that `run` rejects with ServiceBusyError at once, so a flood of logins
 * cannot queue unbounded memory (the cost: hash-queue saturation makes logins
 * return 503 for everyone while an attack lasts; limiters reduce, not remove, that).
 */
export function createLimiter(options: {
  concurrency: number
  maxQueue: number
}): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= options.concurrency) {
        if (waiting.length >= options.maxQueue) throw new ServiceBusyError()
        // The slot is handed over by the task that finishes: `active` stays counted.
        await new Promise<void>((resolve) => waiting.push(resolve))
      } else {
        active += 1
      }
      try {
        return await task()
      } finally {
        const next = waiting.shift()
        if (next === undefined) active -= 1
        else next()
      }
    },
  }
}

export interface PasswordService {
  hash: (password: string) => Promise<string>
  /** True only if the password matches. Never throws on a bad stored string. */
  verify: (password: string, stored: string) => Promise<boolean>
  /**
   * Costs the same as a real verify and always answers false. Login calls it for an
   * unknown email so response time does not reveal whether the account exists.
   */
  verifyDummy: (password: string) => Promise<false>
  /** True if the stored hash is malformed or was made with other parameters. */
  needsRehash: (stored: string) => boolean
  readonly dummyHash: string
}

export interface PasswordServiceOptions {
  params?: ScryptParams
  deriveKey?: DeriveKey
  concurrency?: number
  maxQueue?: number
}

export async function createPasswordService(
  options: PasswordServiceOptions = {},
): Promise<PasswordService> {
  const params = options.params ?? PRODUCTION_SCRYPT
  const derive = options.deriveKey ?? defaultDeriveKey
  const limiter = createLimiter({
    concurrency: options.concurrency ?? 2,
    maxQueue: options.maxQueue ?? 32,
  })

  async function hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH)
    const key = await limiter.run(() =>
      derive(normalizePassword(password), salt, KEY_LENGTH, params),
    )
    return encode(params, salt, key)
  }

  async function verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseHash(stored)
    if (parsed === null) return false
    if (typeof password !== 'string' || password.length > MAX_INPUT_LENGTH) {
      return false
    }
    const key = await limiter.run(() =>
      derive(
        normalizePassword(password),
        parsed.salt,
        KEY_LENGTH,
        parsed.params,
      ),
    )
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key)
  }

  // Computed once at construction with the CURRENT parameters (and a secret nobody
  // knows), so verifying against it costs exactly as much as a real verify.
  const dummyHash = await hash(randomBytes(32).toString('hex'))

  return {
    hash,
    verify,
    async verifyDummy(password) {
      await verify(password, dummyHash)
      return false
    },
    needsRehash(stored) {
      const parsed = parseHash(stored)
      return (
        parsed === null ||
        parsed.params.N !== params.N ||
        parsed.params.r !== params.r ||
        parsed.params.p !== params.p
      )
    },
    dummyHash,
  }
}
