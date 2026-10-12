import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { makeBrand } from '../db/helpers'
import { post } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { join, organization, person } from '../support/orgFixture'
import {
  draftTree,
  publish,
  releaseRows,
  releasesUrl,
  seedDraft,
  type ReleaseBody,
} from '../support/releaseFixture'
import {
  getTokens,
  putToken,
  revisionOf,
  tokenTeam,
  tokensUrl,
  type TokenBody,
  type TokenTeam,
} from '../support/tokenFixture'

// Reading releases: list (cursor pagination), one release with its snapshot, and its
// CSS with a strong ETag (ADR 0015). All VIEWER+; a release of another brand or
// organization is the same 404 as a number that does not exist.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const body = (r: request.Response) => r.body as ReleaseBody
const get = (t: TokenTeam, who: { cookie: string } | null, tail = '') => {
  const test = request(t.app).get(releasesUrl(t, tail))
  return who === null ? test : test.set('Cookie', who.cookie)
}

/** `count` cheap releases written with raw SQL (numbers 1..count). */
async function bulkReleases(t: TokenTeam, count: number) {
  await pool.query(
    `INSERT INTO "Release"
       ("brandId", "number", "sourceRevision", "snapshot", "css", "cssSha256", "createdById", "note")
     SELECT $1::uuid, n, n, '{}'::jsonb, ':root {}', repeat('a', 64), $2::uuid, 'release ' || n
     FROM generate_series(1, $3::int) AS n`,
    [t.brand, t.editor.id, count],
  )
}

/** Publishes a real release after a one-token change; returns its number. */
async function publishAgain(t: TokenTeam, i: number): Promise<number> {
  await putToken(t, t.editor, `semantic.step.s-${i}`, {
    type: 'number',
    value: i,
  })
  const revision = await revisionOf(pool, t.brand)
  const r = await publish(t, t.editor, { expectedRevision: revision })
  expect(r.status).toBe(201)
  return body(r).release?.number ?? -1
}

describe('GET /releases: the list', () => {
  it('is empty for a brand with no release', async () => {
    const t = await tokenTeam(pool, db)
    const r = await get(t, t.viewer)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ releases: [], nextBefore: null })
  })

  it('is metadata only, newest first', async () => {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: 3, note: 'first' })
    await publishAgain(t, 1)
    const r = await get(t, t.viewer)
    expect(r.status).toBe(200)
    expect(body(r).releases?.map((x) => x.number)).toEqual([2, 1])
    expect(body(r).nextBefore).toBeNull()
    for (const release of body(r).releases ?? []) {
      expect(Object.keys(release).sort()).toEqual(
        [
          'createdAt',
          'createdById',
          'cssSha256',
          'note',
          'number',
          'sourceRevision',
        ].sort(),
      )
    }
    expect(body(r).releases?.[1]?.note).toBe('first')
  })

  it('defaults to 20 per page and walks to the end with no gap and no repeat (25 releases)', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 25)
    const first = await get(t, t.viewer)
    expect(body(first).releases).toHaveLength(20)
    expect(body(first).releases?.[0]?.number).toBe(25)
    expect(body(first).nextBefore).toBe(6)

    const seen: number[] = body(first).releases?.map((x) => x.number) ?? []
    let cursor = body(first).nextBefore
    let pages = 1
    while (cursor !== null && cursor !== undefined) {
      const page = await get(t, t.viewer, `?before=${cursor}`)
      expect(page.status).toBe(200)
      seen.push(...(body(page).releases?.map((x) => x.number) ?? []))
      cursor = body(page).nextBefore
      pages += 1
      expect(pages).toBeLessThan(10)
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => 25 - i))
  })

  it.each([
    [1, 25],
    [5, 25],
    [100, 25],
  ])(
    'limit=%i pages through 25 releases exactly once',
    async (limit, total) => {
      const t = await tokenTeam(pool, db)
      await bulkReleases(t, total)
      const seen: number[] = []
      let before: number | null | undefined
      for (let guard = 0; guard < 60; guard += 1) {
        const query: string =
          before === undefined || before === null
            ? `?limit=${limit}`
            : `?limit=${limit}&before=${before}`
        const page = await get(t, t.viewer, query)
        expect(page.status).toBe(200)
        expect(body(page).releases?.length).toBeLessThanOrEqual(limit)
        seen.push(...(body(page).releases?.map((x) => x.number) ?? []))
        before = body(page).nextBefore
        if (before === null || before === undefined) break
      }
      expect(seen).toEqual(Array.from({ length: total }, (_, i) => total - i))
    },
  )

  it('the last page has nextBefore null even when it is exactly full', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 10)
    const r = await get(t, t.viewer, '?limit=5&before=6')
    expect(body(r).releases?.map((x) => x.number)).toEqual([5, 4, 3, 2, 1])
    expect(body(r).nextBefore).toBeNull()
  })

  it('before=1 (or beyond the oldest) is an empty last page', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 3)
    const r = await get(t, t.viewer, '?before=1')
    expect(r.body).toEqual({ releases: [], nextBefore: null })
  })

  it.each([
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=abc',
    'limit=1e2',
    'limit=5.5',
    'limit=',
    'limit=1&limit=2',
    'before=0',
    'before=-1',
    'before=abc',
    'before=2147483648',
    'before=1.5',
    'before=',
    'before=1&before=2',
    'foo=1',
    'limit=5&sort=asc',
  ])('the query %s is a 400 VALIDATION_ERROR', async (query) => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 3)
    const r = await get(t, t.viewer, `?${query}`)
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('VALIDATION_ERROR')
  })

  it('limit=100 and before=2147483647 are accepted', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 2)
    const r = await get(t, t.viewer, '?limit=100&before=2147483647')
    expect(r.status).toBe(200)
    expect(body(r).releases).toHaveLength(2)
  })
})

describe('GET /releases/:number', () => {
  it('returns the metadata AND the snapshot (the source tree at publish time)', async () => {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: 3, note: 'v1' })
    const tree = await draftTree(pool, t.brand)
    // the draft moves on; release 1 does not
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 })

    const r = await get(t, t.viewer, '/1')
    expect(r.status).toBe(200)
    const release = body(r).release
    expect(release).toMatchObject({ number: 1, sourceRevision: 3, note: 'v1' })
    expect(release?.snapshot).toEqual(tree)
    expect(release?.css).toBeUndefined() // the css has its own route
  })

  it.each(['0', '-1', '2147483648', '1.5', 'abc', '01', '1e2', '+1', '%20'])(
    'the number %s is a 404 with the same body as a number that does not exist',
    async (value) => {
      const t = await tokenTeam(pool, db)
      await bulkReleases(t, 1)
      const missing = await get(t, t.viewer, '/999')
      const r = await get(t, t.viewer, `/${value}`)
      expect(r.status).toBe(404)
      expect(r.body).toEqual(missing.body)
      expect((await get(t, t.viewer, `/${value}/css`)).status).toBe(404)
    },
  )

  it('a release of ANOTHER brand of the same organization is a 404', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 2)
    const other = String(
      (await makeBrand(pool, { organizationId: t.org, slug: 'other' }))['id'],
    )
    const r = await get({ ...t, brand: other }, t.viewer, '/1')
    expect(r.status).toBe(404)
    expect((await get({ ...t, brand: other }, t.viewer, '/1/css')).status).toBe(
      404,
    )
  })
})

describe('GET /releases/:number/css', () => {
  async function withRelease() {
    const t = await tokenTeam(pool, db)
    const revision = await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: revision })
    const [row] = await releaseRows(pool, t.brand)
    if (row === undefined) throw new Error('no release')
    return { t, row }
  }

  it('serves the stored css as text/css with a STRONG ETag (the stored sha256), nosniff and a private revalidating cache', async () => {
    const { t, row } = await withRelease()
    const r = await get(t, t.viewer, '/1/css')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(r.headers['etag']).toBe(`"${row.cssSha256}"`)
    expect(r.headers['etag']?.startsWith('W/')).toBe(false)
    expect(r.headers['cache-control']).toBe('private, no-cache')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.text).toBe(row.css)
  })

  it.each([
    ['the exact ETag', (sha: string) => `"${sha}"`],
    ['a weak form of it', (sha: string) => `W/"${sha}"`],
    ['a list containing it', (sha: string) => `"nope", "${sha}"`],
    ['*', () => '*'],
  ])(
    'If-None-Match with %s gives 304 with no body and the same ETag',
    async (_name, header) => {
      const { t, row } = await withRelease()
      const r = await get(t, t.viewer, '/1/css').set(
        'If-None-Match',
        header(row.cssSha256),
      )
      expect(r.status).toBe(304)
      expect(r.text).toBe('')
      expect(r.headers['etag']).toBe(`"${row.cssSha256}"`)
    },
  )

  it('a non-matching If-None-Match gets the full 200', async () => {
    const { t, row } = await withRelease()
    const r = await get(t, t.viewer, '/1/css').set(
      'If-None-Match',
      `"${'b'.repeat(64)}"`,
    )
    expect(r.status).toBe(200)
    expect(r.text).toBe(row.css)
  })

  it('HEAD answers like GET without a body', async () => {
    const { t, row } = await withRelease()
    const r = await request(t.app)
      .head(releasesUrl(t, '/1/css'))
      .set('Cookie', t.viewer.cookie)
    expect(r.status).toBe(200)
    expect(r.headers['etag']).toBe(`"${row.cssSha256}"`)
    expect(r.text ?? '').toBe('')
  })
})

describe('reading releases: access', () => {
  it('a viewer reads; a non-member gets 404; anonymous gets 401 (list, one release, css)', async () => {
    const t = await tokenTeam(pool, db)
    await bulkReleases(t, 1)
    const outsiderOrg = await organization(pool, 'reader-outsider')
    const outsider = await person(pool, t.sessions, 'reader@example.com')
    await join(pool, outsider.id, outsiderOrg, 'OWNER')
    for (const tail of ['', '/1', '/1/css']) {
      expect((await get(t, t.viewer, tail)).status, tail).toBe(200)
      expect((await get(t, outsider, tail)).status, tail).toBe(404)
      expect((await get(t, null, tail)).status, tail).toBe(401)
    }
  })
})

describe('rollback: a release snapshot can be imported back as the draft (ADR 0015)', () => {
  it('release 1 -> change the draft -> import release 1’s snapshot -> publish again: the new release equals release 1 byte for byte', async () => {
    const t = await tokenTeam(pool, db)
    const revision = await seedDraft(pool, t)
    expect(
      (await publish(t, t.editor, { expectedRevision: revision })).status,
    ).toBe(201)

    // the draft drifts: a change, an addition and a removal-by-replacement
    await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.blue}',
      expectedVersion: 2,
      description: 'now described',
    })
    await putToken(t, t.editor, 'semantic.n.extra', {
      type: 'number',
      value: 7,
    })
    const drifted = await publish(t, t.editor, {
      expectedRevision: await revisionOf(pool, t.brand),
    })
    expect(drifted.status).toBe(201)

    const old = await get(t, t.viewer, '/1')
    const imported = await post(request(t.app), tokensUrl(t, '/import'), {
      tree: body(old).release?.snapshot,
      expectedRevision: await revisionOf(pool, t.brand),
    }).set('Cookie', t.editor.cookie)
    expect(imported.status).toBe(200)

    // the draft is release 1's source tree again
    const tree = await getTokens(t, t.viewer, '/tree')
    expect((tree.body as TokenBody).tree).toEqual(body(old).release?.snapshot)

    // and publishing it gives release 3, identical to release 1 (the import bumped
    // the revision, so NO_CHANGES does not apply: it compares revisions, not content)
    const again = await publish(t, t.editor, {
      expectedRevision: await revisionOf(pool, t.brand),
    })
    expect(again.status).toBe(201)
    expect(body(again).release?.number).toBe(3)
    const rows = await releaseRows(pool, t.brand)
    expect(rows[2]?.css).toBe(rows[0]?.css)
    expect(rows[2]?.cssSha256).toBe(rows[0]?.cssSha256)
    expect(rows[2]?.snapshot).toEqual(rows[0]?.snapshot)
  })
})
