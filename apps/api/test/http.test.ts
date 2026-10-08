import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'
import { createReadinessCheck } from '../src/db/ready'
import { assertTestDatabase } from './support/guard'

// Minimal HTTP checks for the two probe endpoints (supertest, no real port).

describe('GET /health', () => {
  it('answers 200 {"status":"ok"} and never touches the database', async () => {
    const checkReady = vi.fn().mockResolvedValue(false)
    const response = await request(createApp({ checkReady })).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(checkReady).not.toHaveBeenCalled()
  })

  it('stays 200 when the database check would throw or hang', async () => {
    const app = createApp({ checkReady: () => new Promise(() => undefined) })
    expect((await request(app).get('/health')).status).toBe(200)
  })

  it('does not advertise the framework', async () => {
    const response = await request(
      createApp({ checkReady: () => Promise.resolve(true) }),
    ).get('/health')
    expect(response.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /ready', () => {
  it('is 200 against the real test database', async () => {
    const readiness = createReadinessCheck(
      assertTestDatabase(process.env['DATABASE_URL']),
    )
    try {
      const response = await request(
        createApp({ checkReady: readiness.check }),
      ).get('/ready')
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: 'ready' })
    } finally {
      await readiness.close()
    }
  })

  it('is 503 with no details when the database is unreachable', async () => {
    const readiness = createReadinessCheck(
      'postgresql://nobody:nothing@127.0.0.1:1/dts_test',
    )
    try {
      const response = await request(
        createApp({ checkReady: readiness.check }),
      ).get('/ready')
      expect(response.status).toBe(503)
      expect(response.body).toEqual({ status: 'unavailable' })
      expect(JSON.stringify(response.body)).not.toMatch(
        /ECONNREFUSED|127\.0\.0\.1|nobody/,
      )
    } finally {
      await readiness.close()
    }
  })

  it('is 503 when the check says not ready, throws, or never answers', async () => {
    const answers: [string, () => Promise<boolean>][] = [
      ['false', () => Promise.resolve(false)],
      ['a rejection', () => Promise.reject(new Error('boom'))],
      ['no answer', () => new Promise<boolean>(() => undefined)],
    ]
    for (const [name, checkReady] of answers) {
      const response = await request(
        createApp({ checkReady, readyTimeoutMs: 50 }),
      ).get('/ready')
      expect(response.status, name).toBe(503)
      expect(response.body, name).toEqual({ status: 'unavailable' })
    }
  })

  it('recovers: the same app answers 200 once the check succeeds', async () => {
    let up = false
    const app = createApp({ checkReady: () => Promise.resolve(up) })
    expect((await request(app).get('/ready')).status).toBe(503)
    up = true
    expect((await request(app).get('/ready')).status).toBe(200)
  })
})

describe('unknown routes', () => {
  it('are 404', async () => {
    const app = createApp({ checkReady: () => Promise.resolve(true) })
    expect((await request(app).get('/nope')).status).toBe(404)
  })
})
