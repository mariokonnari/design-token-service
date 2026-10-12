import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ServiceBusyError } from '../../src/errors'
import {
  PRODUCTION_SCRYPT,
  createLimiter,
  createPasswordService,
  normalizePassword,
  validatePasswordPolicy,
  type DeriveKey,
} from '../../src/auth/password'

// Fast parameters for tests. The production parameters get ONE real round trip below.
const FAST = { N: 1024, r: 8, p: 1 }
const HASH_FORMAT =
  /^scrypt\$N=\d+,r=\d+,p=\d+\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/

describe('hash and verify', () => {
  it('round trips and rejects a wrong password', async () => {
    const service = await createPasswordService({ params: FAST })
    const stored = await service.hash('correct horse battery staple')
    expect(await service.verify('correct horse battery staple', stored)).toBe(
      true,
    )
    expect(await service.verify('correct horse battery stapl', stored)).toBe(
      false,
    )
    expect(await service.verify('', stored)).toBe(false)
    expect(await service.verify('CORRECT HORSE BATTERY STAPLE', stored)).toBe(
      false,
    )
  })

  it('stores a self-describing string: algorithm, parameters, salt, hash', async () => {
    const service = await createPasswordService({ params: FAST })
    const stored = await service.hash('a long enough password')
    expect(stored).toMatch(HASH_FORMAT)
    expect(stored.startsWith('scrypt$N=1024,r=8,p=1$')).toBe(true)
    const [, , salt, key] = stored.split('$')
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(16)
    expect(Buffer.from(key ?? '', 'base64url')).toHaveLength(32)
  })

  it('uses a fresh random salt every time', async () => {
    const service = await createPasswordService({ params: FAST })
    const a = await service.hash('same password here')
    const b = await service.hash('same password here')
    expect(a).not.toBe(b)
    expect(await service.verify('same password here', a)).toBe(true)
    expect(await service.verify('same password here', b)).toBe(true)
  })

  it('normalizes with NFKC, so equivalent Unicode spellings match', async () => {
    const service = await createPasswordService({ params: FAST })
    const stored = await service.hash('ｐａｓｓｗｏｒｄ１２３４５６') // full-width
    expect(await service.verify('password123456', stored)).toBe(true)
    expect(normalizePassword('é')).toBe('é')
  })

  it('handles a 128 character and a non-ASCII password', async () => {
    const service = await createPasswordService({ params: FAST })
    for (const password of ['x'.repeat(128), 'пароль-密码-🔑-ok-ok-ok']) {
      const stored = await service.hash(password)
      expect(await service.verify(password, stored)).toBe(true)
    }
  })

  it('works with the real production parameters (one slow round trip)', async () => {
    expect(PRODUCTION_SCRYPT).toEqual({ N: 65536, r: 8, p: 2 })
    const service = await createPasswordService()
    const stored = await service.hash('production parameters ok')
    expect(stored.startsWith('scrypt$N=65536,r=8,p=2$')).toBe(true)
    expect(await service.verify('production parameters ok', stored)).toBe(true)
    expect(service.needsRehash(stored)).toBe(false)
  })
})

describe('malformed or tampered stored hashes never throw', () => {
  const valid =
    'scrypt$N=1024,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const salt = 'AAAAAAAAAAAAAAAAAAAAAA'
  const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const cases: [string, string][] = [
    ['empty', ''],
    ['one word', 'scrypt'],
    ['trailing dollar', 'scrypt$'],
    ['missing key', `scrypt$N=1024,r=8,p=1$${salt}`],
    ['extra segment', `${valid}$extra`],
    ['other algorithm', valid.replace('scrypt', 'argon2id')],
    ['uppercase algorithm', valid.replace('scrypt', 'SCRYPT')],
    ['non numeric N', valid.replace('N=1024', 'N=abc')],
    ['N not a power of two', valid.replace('N=1024', 'N=1000')],
    ['N too small', valid.replace('N=1024', 'N=2')],
    ['N zero', valid.replace('N=1024', 'N=0')],
    ['N negative', valid.replace('N=1024', 'N=-1024')],
    ['N above the cap', valid.replace('N=1024', 'N=262144')],
    ['N huge (2^30)', valid.replace('N=1024', 'N=1073741824')],
    ['N absurd digits', valid.replace('N=1024', `N=${'9'.repeat(40)}`)],
    ['r zero', valid.replace('r=8', 'r=0')],
    ['r above the cap', valid.replace('r=8', 'r=17')],
    ['p zero', valid.replace('p=1', 'p=0')],
    ['p above the cap', valid.replace('p=1', 'p=17')],
    ['memory over the cap (N*r)', valid.replace('N=1024,r=8', 'N=131072,r=16')],
    [
      'parameters out of order',
      valid.replace('N=1024,r=8,p=1', 'r=8,N=1024,p=1'),
    ],
    ['extra parameter', valid.replace('p=1', 'p=1,x=1')],
    ['padding in base64', `scrypt$N=1024,r=8,p=1$${salt}$${key}=`],
    [
      'bad base64 characters',
      `scrypt$N=1024,r=8,p=1$${salt.slice(0, 21)}!$${key}`,
    ],
    ['short salt', `scrypt$N=1024,r=8,p=1$${salt.slice(0, 20)}$${key}`],
    ['long salt', `scrypt$N=1024,r=8,p=1$${salt}AA$${key}`],
    ['short key', `scrypt$N=1024,r=8,p=1$${salt}$${key.slice(0, 42)}`],
    ['long key', `scrypt$N=1024,r=8,p=1$${salt}$${key}A`],
    [
      'non-canonical base64 (stray bits)',
      `scrypt$N=1024,r=8,p=1$${salt.slice(0, 21)}B$${key}`,
    ],
    ['unicode', 'scrypt$N=1024,r=8,p=1$éééééééééééééééééééééé$ééé'],
    ['whitespace', ` ${valid} `],
    ['newline', `${valid}\n`],
    ['a megabyte of junk', 'x'.repeat(1_000_000)],
  ]

  it.each(cases)(
    'rejects (false) and does not throw: %s',
    async (_name, stored) => {
      const calls: unknown[] = []
      const derive: DeriveKey = (...args) => {
        calls.push(args)
        return Promise.resolve(Buffer.alloc(32))
      }
      const service = await createPasswordService({
        params: FAST,
        deriveKey: derive,
      })
      calls.length = 0 // ignore the dummy hash computed at construction
      await expect(service.verify('any password at all', stored)).resolves.toBe(
        false,
      )
      if (
        !stored.startsWith('scrypt$N=1024,r=8,p=1$AAAA') ||
        stored !== valid
      ) {
        // Refused BEFORE deriving: a hostile string must never cost memory or CPU.
        expect(calls).toHaveLength(0)
      }
    },
  )

  it('refuses a hostile N=2^30 string instantly without allocating', async () => {
    const service = await createPasswordService({ params: FAST })
    const started = performance.now()
    const before = process.memoryUsage().rss
    const result = await service.verify(
      'x',
      valid.replace('N=1024', 'N=1073741824'),
    )
    expect(result).toBe(false)
    expect(performance.now() - started).toBeLessThan(200)
    expect(process.memoryUsage().rss - before).toBeLessThan(50 * 1024 * 1024)
  })

  it('a single flipped character of a real hash fails verification', async () => {
    const service = await createPasswordService({ params: FAST })
    const stored = await service.hash('flip one character')
    const index = stored.length - 5
    const flipped =
      stored.slice(0, index) +
      (stored[index] === 'A' ? 'B' : 'A') +
      stored.slice(index + 1)
    expect(await service.verify('flip one character', flipped)).toBe(false)
  })

  it('non-string inputs return false instead of throwing', async () => {
    const service = await createPasswordService({ params: FAST })
    for (const value of [null, undefined, 42, {}, [], Buffer.from('x')]) {
      await expect(service.verify('pw', value as never)).resolves.toBe(false)
    }
    expect(service.needsRehash(null as never)).toBe(true)
  })

  it('a stored hash with weak (but allowed) parameters still verifies', async () => {
    const weak = await createPasswordService({
      params: { N: 1024, r: 8, p: 1 },
    })
    const strong = await createPasswordService({
      params: { N: 2048, r: 8, p: 1 },
    })
    const stored = await weak.hash('verify with the stored params')
    expect(await strong.verify('verify with the stored params', stored)).toBe(
      true,
    )
  })
})

describe('needsRehash and the upgrade path', () => {
  it('is false for the current parameters and true for anything else', async () => {
    const current = await createPasswordService({
      params: { N: 2048, r: 8, p: 1 },
    })
    const stored = await current.hash('current parameters')
    expect(current.needsRehash(stored)).toBe(false)
    for (const params of [
      { N: 1024, r: 8, p: 1 },
      { N: 2048, r: 8, p: 2 },
      { N: 2048, r: 16, p: 1 },
      { N: 4096, r: 8, p: 1 }, // stronger than current also counts as "different"
    ]) {
      const other = await createPasswordService({ params })
      expect(current.needsRehash(await other.hash('x'.repeat(12)))).toBe(true)
    }
  })

  it('treats every malformed string as needing a rehash', async () => {
    const service = await createPasswordService({ params: FAST })
    for (const stored of ['', 'garbage', 'scrypt$', 'argon2id$x$y$z']) {
      expect(service.needsRehash(stored)).toBe(true)
    }
  })

  it('upgrades: verify with the old hash, rehash with the new parameters, verify again', async () => {
    const oldService = await createPasswordService({
      params: { N: 1024, r: 8, p: 1 },
    })
    const newService = await createPasswordService({
      params: { N: 2048, r: 8, p: 2 },
    })
    const oldHash = await oldService.hash('upgrade me please')
    expect(await newService.verify('upgrade me please', oldHash)).toBe(true)
    expect(newService.needsRehash(oldHash)).toBe(true)
    const newHash = await newService.hash('upgrade me please')
    expect(newService.needsRehash(newHash)).toBe(false)
    expect(newHash.startsWith('scrypt$N=2048,r=8,p=2$')).toBe(true)
    expect(await newService.verify('upgrade me please', newHash)).toBe(true)
  })
})

describe('the dummy hash (for unknown emails)', () => {
  it('has the current parameters, so it costs the same as a real verify', async () => {
    const service = await createPasswordService({ params: FAST })
    expect(service.dummyHash).toMatch(HASH_FORMAT)
    expect(service.dummyHash.startsWith('scrypt$N=1024,r=8,p=1$')).toBe(true)
    expect(service.needsRehash(service.dummyHash)).toBe(false)
  })

  it('verifyDummy runs exactly one key derivation and always answers false', async () => {
    let derivations = 0
    const derive: DeriveKey = (password, salt, length, params) => {
      derivations += 1
      return Promise.resolve(Buffer.alloc(length, params.N % 251))
    }
    const service = await createPasswordService({
      params: FAST,
      deriveKey: derive,
    })
    derivations = 0
    await expect(service.verifyDummy('whatever password')).resolves.toBe(false)
    expect(derivations).toBe(1)
  })
})

describe('the concurrency limiter', () => {
  function gate() {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }

  it('never runs more than the cap at once, and finishes everything', async () => {
    let active = 0
    let max = 0
    const open = gate()
    let armed = false // the dummy hash computed at construction must not wait
    const derive: DeriveKey = async (_p, _s, length) => {
      if (!armed) return Buffer.alloc(length)
      active += 1
      max = Math.max(max, active)
      await open.promise
      active -= 1
      return Buffer.alloc(length)
    }
    const service = await createPasswordService({
      params: FAST,
      deriveKey: derive,
      concurrency: 2,
      maxQueue: 50,
    })
    armed = true
    max = 0
    const work = Array.from({ length: 10 }, () =>
      service.hash('a password long enough'),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(active).toBe(2)
    open.release()
    await Promise.all(work)
    expect(max).toBe(2)
    expect(active).toBe(0)
  })

  it('refuses work beyond the bounded queue with ServiceBusyError, then recovers', async () => {
    const limiter = createLimiter({ concurrency: 1, maxQueue: 2 })
    const open = gate()
    const run = () => limiter.run(async () => open.promise)
    const first = run() // running
    const second = run() // queued 1
    const third = run() // queued 2
    await expect(run()).rejects.toBeInstanceOf(ServiceBusyError)
    await expect(run()).rejects.toBeInstanceOf(ServiceBusyError)
    open.release()
    await Promise.all([first, second, third])
    await expect(limiter.run(() => Promise.resolve('again'))).resolves.toBe(
      'again',
    )
  })

  it('keeps going after a task fails (a failure frees its slot)', async () => {
    const limiter = createLimiter({ concurrency: 1, maxQueue: 5 })
    await expect(
      limiter.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    await expect(limiter.run(() => Promise.resolve(7))).resolves.toBe(7)
  })

  it('serves queued work in order', async () => {
    const limiter = createLimiter({ concurrency: 1, maxQueue: 10 })
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limiter.run(async () => {
          await Promise.resolve()
          order.push(n)
        }),
      ),
    )
    expect(order).toEqual([1, 2, 3, 4])
  })
})

describe('the password policy: length 12 to 128, no composition rules', () => {
  it.each([
    ['exactly 12', 'a'.repeat(12)],
    ['exactly 128', 'a'.repeat(128)],
    ['only lowercase', 'abcdefghijkl'],
    ['only digits', '123456789012'],
    ['only spaces and words', 'correct horse battery staple'],
    ['12 emoji (counted as characters)', '🔑'.repeat(12)],
  ])('accepts %s', (_name, password) => {
    expect(validatePasswordPolicy(password)).toBeNull()
  })

  it.each([
    ['11 characters', 'a'.repeat(11), /at least 12/],
    ['129 characters', 'a'.repeat(129), /at most 128/],
    ['empty', '', /at least 12/],
    ['11 emoji', '🔑'.repeat(11), /at least 12/],
  ])('rejects %s', (_name, password, reason) => {
    expect(validatePasswordPolicy(password)).toMatch(reason)
  })

  it('rejects non-strings and counts length after NFKC normalization', () => {
    expect(validatePasswordPolicy(123)).toMatch(/string/)
    expect(validatePasswordPolicy(undefined)).toMatch(/string/)
    // 12 full-width characters normalize to 12 ASCII characters: still fine.
    expect(validatePasswordPolicy('ａ'.repeat(12))).toBeNull()
    // A very long input is refused without hashing anything.
    expect(validatePasswordPolicy(randomBytes(4000).toString('hex'))).toMatch(
      /at most 128/,
    )
  })
})
