import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient, type Db } from '../../src/db/client'
import { authApp, patch } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  extraBrand,
  otherTenant,
  publicPath,
  publishAnother,
  publishedTeam,
  sha256Hex,
  stableHeaders,
  untouchableDb,
} from '../support/publicFixture'
import { releaseRows } from '../support/releaseFixture'
import { tokenTeam, brandUrl, type TokenTeam } from '../support/tokenFixture'

// The PUBLIC endpoints (ADR 0015): no session, the latest release of a PUBLIC brand
// only, one uniform 404, and a cross-origin exception (CORP + ACAO) that exists on
// these two routes and nowhere else.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const FORMATS = ['css', 'json'] as const
const NOT_FOUND = '{"error":{"code":"NOT_FOUND","message":"Not found."}}'

const getPublic = (
  t: TokenTeam,
  orgSlug: string,
  brandSlug: string,
  format: string,
) => request(t.app).get(publicPath(orgSlug, brandSlug, format))

async function setup(visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const t = await tokenTeam(pool, db)
  return publishedTeam(pool, t, visibility)
}

describe('GET /api/public/.../css', () => {
  it('serves the LATEST release’s stored css to anyone, with the cross-origin headers, a strong ETag and a 60 s public cache (no immutable)', async () => {
    const t = await setup()
    const [row] = await releaseRows(pool, t.brand)
    const r = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    expect(r.status).toBe(200)
    expect(r.text).toBe(row?.css)
    expect(r.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(r.headers['etag']).toBe(`"${row?.cssSha256}"`)
    expect(r.headers['cache-control']).toBe('public, max-age=60')
    expect(r.headers['cache-control']).not.toContain('immutable')
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(r.headers['access-control-allow-origin']).toBe('*')
    expect(r.headers['access-control-allow-credentials']).toBeUndefined()
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(String(r.headers['vary'] ?? '').toLowerCase()).not.toContain(
      'origin',
    )
  })

  it('a later release replaces it at once (nothing is cached on the server): new body, new ETag', async () => {
    const t = await setup()
    const first = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    await publishAnother(pool, t, 'a', 4)
    const second = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    expect(second.status).toBe(200)
    expect(second.text).not.toBe(first.text)
    expect(second.headers['etag']).not.toBe(first.headers['etag'])
    const rows = await releaseRows(pool, t.brand)
    expect(second.text).toBe(rows[1]?.css)
  })
})

describe('GET /api/public/.../json', () => {
  it('serves the latest release’s SOURCE tree (aliases, descriptions included) as JSON with the same headers', async () => {
    const t = await setup()
    const [row] = await releaseRows(pool, t.brand)
    const r = await getPublic(t, t.orgSlug, t.brandSlug, 'json')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(r.body).toEqual(row?.snapshot)
    // the source tree: the alias is still an alias, the description is public
    expect(JSON.stringify(r.body)).toContain('{primitive.color.blue}')
    expect(JSON.stringify(r.body)).toContain('The main action colour')
    expect(r.headers['etag']).toBe(`"${sha256Hex(r.text)}"`)
    expect(r.headers['cache-control']).toBe('public, max-age=60')
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(r.headers['access-control-allow-origin']).toBe('*')
    expect(r.headers['access-control-allow-credentials']).toBeUndefined()
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })

  it('a later release replaces it: new body, new ETag', async () => {
    const t = await setup()
    const first = await getPublic(t, t.orgSlug, t.brandSlug, 'json')
    await publishAnother(pool, t, 'b', 5)
    const second = await getPublic(t, t.orgSlug, t.brandSlug, 'json')
    expect(second.body).not.toEqual(first.body)
    expect(second.headers['etag']).not.toBe(first.headers['etag'])
  })
})

describe('conditional requests and HEAD', () => {
  it.each(FORMATS)(
    '%s: If-None-Match gives 304 (exact, weak, list, *) and keeps the cross-origin and cache headers',
    async (format) => {
      const t = await setup()
      const ok = await getPublic(t, t.orgSlug, t.brandSlug, format)
      const etag = String(ok.headers['etag'])
      for (const header of [etag, `W/${etag}`, `"x", ${etag}`, '*']) {
        const r = await getPublic(t, t.orgSlug, t.brandSlug, format).set(
          'If-None-Match',
          header,
        )
        expect(r.status, header).toBe(304)
        expect(r.text, header).toBe('')
        expect(r.headers['etag'], header).toBe(etag)
        expect(r.headers['cache-control'], header).toBe('public, max-age=60')
        expect(r.headers['cross-origin-resource-policy'], header).toBe(
          'cross-origin',
        )
        expect(r.headers['access-control-allow-origin'], header).toBe('*')
      }
      const miss = await getPublic(t, t.orgSlug, t.brandSlug, format).set(
        'If-None-Match',
        `"${'0'.repeat(64)}"`,
      )
      expect(miss.status).toBe(200)
    },
  )

  it.each(FORMATS)(
    '%s: HEAD behaves like GET without a body (same status and headers; 304 when conditional)',
    async (format) => {
      const t = await setup()
      const get = await getPublic(t, t.orgSlug, t.brandSlug, format)
      const head = await request(t.app).head(
        publicPath(t.orgSlug, t.brandSlug, format),
      )
      expect(head.status).toBe(200)
      expect(head.text ?? '').toBe('')
      expect(stableHeaders(head)).toEqual(stableHeaders(get))
      const conditional = await request(t.app)
        .head(publicPath(t.orgSlug, t.brandSlug, format))
        .set('If-None-Match', String(get.headers['etag']))
      expect(conditional.status).toBe(304)
    },
  )
})

describe('ONE uniform 404: private, missing, no release, malformed', () => {
  it.each(FORMATS)(
    '%s: every refusal is byte-identical (status, body, headers)',
    async (format) => {
      const t = await setup() // PUBLIC with a release: the control
      // (a team's users are unique per database: the other tenants are extra rows)
      const priv = await extraBrand(pool, t, 'private-one', 'PRIVATE', true)
      const norelease = await extraBrand(pool, t, 'no-release', 'PUBLIC', false)
      await otherTenant(
        pool,
        'some-other-org',
        'its-brand',
        'OTHER',
        t.owner.id,
      )

      const cases: [string, string, string][] = [
        ['a PRIVATE brand with releases', priv.orgSlug, priv.brandSlug],
        ['a brand that does not exist', t.orgSlug, 'no-such-brand'],
        ['an organization that does not exist', 'no-such-org', t.brandSlug],
        [
          'a PUBLIC brand with no release',
          norelease.orgSlug,
          norelease.brandSlug,
        ],
        ['the brand of ANOTHER organization', 'some-other-org', t.brandSlug],
        ['an uppercase slug', t.orgSlug.toUpperCase(), t.brandSlug],
        ['a double hyphen', 'a--b', t.brandSlug],
        ['a leading hyphen', t.orgSlug, '-brand'],
        ['dot segments (encoded)', '%2E%2E', '%2E'],
        ['an encoded slash', 'a%2Fb', t.brandSlug],
        ['an encoded NUL', '%00', t.brandSlug],
        ['a 201-character slug', 'a'.repeat(201), t.brandSlug],
        ['a unicode slug', 'caf%C3%A9', t.brandSlug],
        ['an uppercase brand slug', t.orgSlug, t.brandSlug.toUpperCase()],
      ]
      const responses = await Promise.all(
        cases.map(([, org, brand]) => getPublic(t, org, brand, format)),
      )
      for (const [index, response] of responses.entries()) {
        const label = cases[index]?.[0] ?? ''
        expect(response.status, label).toBe(404)
        expect(response.text, label).toBe(NOT_FOUND)
        expect(stableHeaders(response), label).toEqual(
          stableHeaders(responses[0] as request.Response),
        )
      }
      const headers = stableHeaders(responses[0] as request.Response)
      expect(headers['cache-control']).toBe('no-store')
      expect(headers['cross-origin-resource-policy']).toBe('cross-origin')
      expect(headers['access-control-allow-origin']).toBe('*')
      expect(headers['content-type']).toContain('application/json')
      expect(headers['set-cookie']).toBeUndefined()
    },
  )

  it('css and json 404s are identical to each other, and HEAD gives the same headers without a body', async () => {
    const t = await setup('PRIVATE')
    const css = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    const json = await getPublic(t, t.orgSlug, t.brandSlug, 'json')
    expect(css.text).toBe(json.text)
    expect(stableHeaders(css)).toEqual(stableHeaders(json))
    const head = await request(t.app).head(
      publicPath(t.orgSlug, t.brandSlug, 'css'),
    )
    expect(head.status).toBe(404)
    expect(head.text ?? '').toBe('')
    expect(stableHeaders(head)).toEqual(stableHeaders(css))
  })

  it('a valid session changes nothing: an OWNER of the PRIVATE brand’s organization still gets the same 404', async () => {
    const t = await setup('PRIVATE')
    const anonymous = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    const asOwner = await getPublic(t, t.orgSlug, t.brandSlug, 'css').set(
      'Cookie',
      t.owner.cookie,
    )
    expect(asOwner.status).toBe(404)
    expect(asOwner.text).toBe(anonymous.text)
    expect(stableHeaders(asOwner)).toEqual(stableHeaders(anonymous))
  })

  it('a malformed slug never reaches the database (but a valid one does)', async () => {
    let touched = 0
    const guarded = await tokenTeam(pool, db, {
      publicDb: untouchableDb<Db>(() => {
        touched += 1
      }),
    })
    for (const org of ['A', 'a--b', '%2E%2E', 'x'.repeat(201)]) {
      const r = await getPublic(guarded, org, 'brand', 'css')
      expect(r.status, org).toBe(404)
      expect(r.text, org).toBe(NOT_FOUND)
    }
    expect(touched).toBe(0)
    // the double is live: a well-formed slug DOES query (and the double refuses it: 500)
    const valid = await getPublic(guarded, 'some-org', 'some-brand', 'css')
    expect(valid.status).toBe(500)
    expect(touched).toBeGreaterThan(0)
  })
})

describe('privacy is read on EVERY request', () => {
  it('flipping the brand to PRIVATE makes the public URL a 404 on the very next request, and back again restores it', async () => {
    const t = await setup()
    for (const format of FORMATS) {
      expect((await getPublic(t, t.orgSlug, t.brandSlug, format)).status).toBe(
        200,
      )
    }
    const flip = await patch(request(t.app), brandUrl(t), {
      visibility: 'PRIVATE',
    }).set('Cookie', t.owner.cookie)
    expect(flip.status).toBe(200)
    for (const format of FORMATS) {
      const r = await getPublic(t, t.orgSlug, t.brandSlug, format)
      expect(r.status, format).toBe(404)
      expect(r.text, format).toBe(NOT_FOUND)
    }
    const back = await patch(request(t.app), brandUrl(t), {
      visibility: 'PUBLIC',
    }).set('Cookie', t.owner.cookie)
    expect(back.status).toBe(200)
    for (const format of FORMATS) {
      expect((await getPublic(t, t.orgSlug, t.brandSlug, format)).status).toBe(
        200,
      )
    }
  })

  it('a brand is PRIVATE by default: publishing alone exposes nothing', async () => {
    const t = await tokenTeam(pool, db)
    const published = await publishedTeam(pool, t, 'PRIVATE')
    expect(
      (await getPublic(t, published.orgSlug, published.brandSlug, 'css'))
        .status,
    ).toBe(404)
  })
})

describe('tenants do not mix', () => {
  it('two organizations with the SAME brand slug each get their own content', async () => {
    const t = await setup()
    const mine = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    const other = await otherTenant(
      pool,
      'other-public-org',
      t.brandSlug,
      'OTHER TENANT',
      t.owner.id,
    )
    const theirs = await getPublic(t, 'other-public-org', t.brandSlug, 'css')
    expect(theirs.status).toBe(200)
    expect(theirs.text).toBe(other.css)
    const mineAgain = await getPublic(t, t.orgSlug, t.brandSlug, 'css')
    expect(mineAgain.text).toBe(mine.text)
    expect(mineAgain.text).not.toContain('OTHER TENANT')
  })
})

describe('the cross-origin exception exists ONLY on the public routes', () => {
  it('every other route keeps Cross-Origin-Resource-Policy: same-origin and sends no access-control-* header', async () => {
    const t = await setup()
    const others = [
      '/health',
      '/api/me',
      `/api/orgs/${t.org}/brands/${t.brand}/releases/1/css`,
      '/api/does-not-exist',
    ]
    for (const path of others) {
      const r = await request(t.app).get(path).set('Cookie', t.owner.cookie)
      expect(r.headers['cross-origin-resource-policy'], path).toBe(
        'same-origin',
      )
      expect(
        Object.keys(r.headers).filter((h) => h.startsWith('access-control-')),
        path,
      ).toEqual([])
    }
  })

  it('a preflight to the public route (a cross-origin fetch with custom headers) gets NO CORS headers, by design', async () => {
    const t = await setup()
    const r = await request(t.app)
      .options(publicPath(t.orgSlug, t.brandSlug, 'css'))
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-custom')
    expect(
      Object.keys(r.headers).filter((h) => h.startsWith('access-control-')),
    ).toEqual([])
  })

  it('the public response never reflects the Origin and never allows credentials', async () => {
    const t = await setup()
    const r = await getPublic(t, t.orgSlug, t.brandSlug, 'css').set(
      'Origin',
      'https://evil.example',
    )
    expect(r.headers['access-control-allow-origin']).toBe('*')
    expect(r.headers['access-control-allow-credentials']).toBeUndefined()
  })
})

describe('per-IP rate limit on the public routes', () => {
  it('blocks with 429 (still readable cross-origin) BEFORE any database work', async () => {
    const published = await setup()
    // a second app (same database) whose PUBLIC repository counts every use of it
    let touched = 0
    const counting = new Proxy(db, {
      get(target, property, receiver) {
        touched += 1
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    const limited = await authApp(db, {
      limits: { publicRead: { limit: 2 } },
      keys: { ip: () => 'one-client' },
      publicDb: counting,
    })
    const url = publicPath(published.orgSlug, published.brandSlug, 'css')
    const seen: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const r = await request(limited.app).get(url)
      seen.push(r.status)
      if (r.status === 429) {
        expect(r.headers['access-control-allow-origin']).toBe('*')
        expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin')
        expect(r.headers['cache-control']).toBe('no-store')
        expect((r.body as { error: { code: string } }).error.code).toBe(
          'RATE_LIMITED',
        )
      }
    }
    expect(seen).toEqual([200, 200, 429, 429])
    expect(touched).toBe(2) // only the two allowed requests used the database
  })
})
