import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../src/db/client'
import { authApp } from './support/authApp'
import { useDatabase } from './support/db'
import { assertTestDatabase } from './support/guard'

// The TEST-ONLY server entry the web e2e suite starts (apps/web/playwright.config.ts).
// It runs under `tsx`, outside Vitest, against a dedicated *_test database. These
// tests pin the safety properties that matter: it never runs against a non-test
// database, never reuses a port that is already taken (a dev API could be there),
// imports nothing from Vitest, and does not collect logs in memory.

useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const ENTRY = join(import.meta.dirname, 'support', 'e2eServer.ts')
const require = createRequire(import.meta.url)
const TSX = require.resolve('tsx/cli')

interface Outcome {
  code: number | null
  output: string
}

/** Runs the entry for real and waits for it to exit (it must exit by itself in these cases). */
function runEntry(env: Record<string, string>): Promise<Outcome> {
  return new Promise((resolveOutcome, reject) => {
    const child = spawn(process.execPath, [TSX, ENTRY], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`the entry did not exit by itself. Output:\n${output}`))
    }, 60_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolveOutcome({ code, output })
    })
  })
}

/** Occupies a port on the loopback interface until `close` is called. */
async function occupy(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer()
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  }
}

describe('the e2e server entry refuses to run unsafely', () => {
  it('exists where the web Playwright config expects it', () => {
    expect(existsSync(ENTRY)).toBe(true)
  })

  it('does not start on a database whose name does not end in _test, and says so', async () => {
    const outcome = await runEntry({
      DATABASE_URL: 'postgresql://dts:dts@localhost:5433/dts_dev',
      E2E_API_PORT: '3199',
    })
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toMatch(/_test/)
    expect(outcome.output).toContain('dts_dev')
    expect(outcome.output).not.toContain('dts:dts')
  }, 70_000)

  it('does not start when its port is already taken (it never reuses a running API) and says so', async () => {
    const taken = await occupy()
    try {
      const outcome = await runEntry({
        DATABASE_URL: process.env['DATABASE_URL'] ?? '',
        E2E_API_PORT: String(taken.port),
      })
      expect(outcome.code).not.toBe(0)
      expect(outcome.output).toMatch(/already in use/i)
      expect(outcome.output).toContain(String(taken.port))
      expect(outcome.output).toMatch(/never reuses/i)
    } finally {
      await taken.close()
    }
  }, 70_000)
})

describe('the e2e server entry can run outside Vitest', () => {
  /** Every local file the entry (transitively) imports, by static relative imports. */
  function reachable(entry: string): string[] {
    const seen = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(
        /(?:import|export)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
      )) {
        const base = resolve(dirname(file), match[1]!)
        const candidate = [`${base}.ts`, join(base, 'index.ts'), base].find(
          (path) => existsSync(path) && /\.tsx?$/.test(path),
        )
        if (candidate !== undefined) queue.push(candidate)
      }
    }
    return [...seen]
  }

  it('imports nothing from vitest, directly or through any local file', () => {
    const files = reachable(ENTRY)
    expect(files.length).toBeGreaterThan(10) // it did walk the app
    expect(files.some((f) => f.endsWith('authApp.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('truncate.ts'))).toBe(true)
    const offenders = files.filter((file) =>
      /from\s+['"]vitest['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('the reachability check can fail (a file that imports vitest is found)', () => {
    const dbSupport = join(import.meta.dirname, 'support', 'db.ts')
    expect(
      reachable(dbSupport).some((file) =>
        /from\s+['"]vitest['"]/.test(readFileSync(file, 'utf8')),
      ),
    ).toBe(true)
  })
})

describe('authApp accepts a logger, so a long-running server collects nothing in memory', () => {
  it('writes to the logger it was given and not to the in-memory capture', async () => {
    const lines: string[] = []
    const { createLogger } = await import('../src/http/logger')
    const { Writable } = await import('node:stream')
    const logger = createLogger({
      level: 'info',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString())
          callback()
        },
      }),
    })
    const ctx = await authApp(db, { logger })
    const response = await request(ctx.app).get('/api/me')
    expect(response.status).toBe(401)
    expect(lines.join('')).toContain('/api/me')
    expect(ctx.capture.text()).toBe('')
  })
})
