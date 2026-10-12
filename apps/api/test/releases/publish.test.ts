import { flatten, resolve, toCssVariables } from '@dts/tokens-core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { isUniqueViolation } from '../../src/db/errors'
import { Prisma } from '../../src/generated/prisma/client'
import { RELEASE_LIMITS } from '../../src/releases/limits'
import { makeToken } from '../db/helpers'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import {
  brandSlug,
  draftTree,
  publish,
  releaseRows,
  releasesUrl,
  seedDraft,
  sha256,
  tables,
  type ReleaseBody,
} from '../support/releaseFixture'
import { join, organization, person } from '../support/orgFixture'
import {
  deleteToken,
  putToken,
  revisionOf,
  tokenTeam,
  type TokenBody,
} from '../support/tokenFixture'

const { pool } = useDatabase()
const url = assertTestDatabase(process.env['DATABASE_URL'])
const db = createPrismaClient(url)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const team = () => tokenTeam(pool, db)
const body = (r: request.Response) => r.body as ReleaseBody
const code = (r: request.Response) => body(r).error?.code

describe('POST /releases: the happy path', () => {
  it.each(['owner', 'editor'] as const)(
    'an %s publishes a valid draft: 201, release metadata only, draftRevision unchanged',
    async (who) => {
      const t = await team()
      const revision = await seedDraft(pool, t)
      expect(revision).toBe(3)

      const r = await publish(t, t[who], {
        expectedRevision: revision,
        note: 'First release',
      })
      expect(r.status).toBe(201)
      expect(body(r).release).toEqual({
        number: 1,
        sourceRevision: 3,
        note: 'First release',
        createdAt: expect.any(String) as unknown,
        createdById: t[who].id,
        cssSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      })
      // metadata only: no snapshot, no css
      expect(Object.keys(body(r).release ?? {}).sort()).toEqual(
        [
          'createdAt',
          'createdById',
          'cssSha256',
          'note',
          'number',
          'sourceRevision',
        ].sort(),
      )
      // PUBLISHING DOES NOT CHANGE draftRevision
      expect(await revisionOf(pool, t.brand)).toBe(3)
      expect(await releaseRows(pool, t.brand)).toHaveLength(1)
    },
  )

  it('note is optional and stored as NULL', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const r = await publish(t, t.editor, { expectedRevision: revision })
    expect(r.status).toBe(201)
    expect(body(r).release?.note).toBeNull()
  })

  it('a note of exactly 500 characters is accepted', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const r = await publish(t, t.editor, {
      expectedRevision: revision,
      note: 'n'.repeat(500),
    })
    expect(r.status).toBe(201)
  })

  it('a changed draft publishes release number 2 (numbers count up per brand)', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: revision })
    await putToken(t, t.editor, 'semantic.size.base', {
      type: 'dimension',
      value: { value: 16, unit: 'px' },
    })
    const r = await publish(t, t.editor, { expectedRevision: revision + 1 })
    expect(r.status).toBe(201)
    expect(body(r).release).toMatchObject({ number: 2, sourceRevision: 4 })
    expect((await releaseRows(pool, t.brand)).map((x) => x.number)).toEqual([
      1, 2,
    ])
  })
})

describe('POST /releases: what is stored', () => {
  async function published() {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const r = await publish(t, t.editor, { expectedRevision: revision })
    const [row] = await releaseRows(pool, t.brand)
    if (row === undefined) throw new Error('no release row')
    return { t, r, row, slug: await brandSlug(pool, t.brand) }
  }

  it('cssSha256 is the sha256 (hex) of the stored css, and the response carries the same hash', async () => {
    const { r, row } = await published()
    expect(row.cssSha256).toBe(sha256(row.css))
    expect(body(r).release?.cssSha256).toBe(row.cssSha256)
  })

  it('the css is scoped to [data-theme="<brand slug>"] and holds semantic + component tokens only', async () => {
    const { row, slug } = await published()
    expect(row.css.startsWith(`[data-theme="${slug}"] {\n`)).toBe(true)
    expect(row.css).toContain('--semantic-color-action: #1a334d;')
    expect(row.css).toContain('--component-button-background: #1a334d;')
    expect(row.css).not.toContain('--primitive-')
    expect(row.css).not.toContain('var(')
  })

  it('the snapshot is the SOURCE tree of the draft (aliases kept), as it was at publish time', async () => {
    const { t, row } = await published()
    expect(row.snapshot).toEqual(await draftTree(pool, t.brand))
    expect(JSON.stringify(row.snapshot)).toContain('{primitive.color.blue}')
  })

  it('is deterministic: regenerating the css from the stored snapshot gives the stored css byte for byte', async () => {
    const { row, slug } = await published()
    const flat = flatten(row.snapshot)
    expect(flat.issues.filter((i) => i.severity === 'error')).toEqual([])
    const { resolved } = resolve(flat.tokens)
    const again = toCssVariables(resolved, {
      scope: { kind: 'attribute', name: 'data-theme', value: slug },
      include: ['semantic', 'component'],
    })
    expect(again.css).toBe(row.css)
    expect(sha256(again.css)).toBe(row.cssSha256)
  })

  it('exporter output passes the CSS safety checks, even with hostile font names', async () => {
    const t = await team()
    const hostile = 'Evil"; } body { color: red } /* </style><script> \\'
    for (const [path, value] of [
      ['semantic.font.body', { type: 'fontFamily', value: [hostile, 'serif'] }],
      [
        'semantic.size.base',
        { type: 'dimension', value: { value: 1, unit: 'rem' } },
      ],
    ] as const) {
      expect((await putToken(t, t.editor, path, value)).status).toBe(201)
    }
    const r = await publish(t, t.editor, { expectedRevision: 2 })
    expect(r.status).toBe(201)
    const [row] = await releaseRows(pool, t.brand)
    const css = row?.css ?? ''
    const slug = await brandSlug(pool, t.brand)
    // exactly: one selector line, one declaration per line, one closing brace
    const lines = css.split('\n')
    expect(lines[0]).toBe(`[data-theme="${slug}"] {`)
    expect(lines[lines.length - 1]).toBe('')
    expect(lines[lines.length - 2]).toBe('}')
    const declarations = lines.slice(1, -2)
    expect(declarations).toHaveLength(2)
    for (const line of declarations) {
      expect(line).toMatch(/^ {2}--[a-z0-9-]+: .+;$/)
    }
    expect(css).not.toContain('</style')
    expect(css).not.toContain('<')
    expect(css).not.toContain('var(')
    // With the quoted strings removed, only the structure is left: the hostile `;`,
    // `{`, `}` and `/*` of the font name were all INSIDE one escaped string.
    const withoutStrings = css.replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    expect(withoutStrings.match(/[{}]/g)).toHaveLength(2)
    expect(withoutStrings.match(/;/g)).toHaveLength(2) // one per declaration
    expect(withoutStrings.split('\n')).toHaveLength(5) // selector, 2 declarations, "}", ""
    expect(withoutStrings).not.toContain('/*')
  })
})

describe('POST /releases: refusals', () => {
  it('a stale expectedRevision is 409 REVISION_CONFLICT with currentRevision; nothing changes', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const before = await tables(pool)
    for (const stale of [revision - 1, revision + 1, 0]) {
      const r = await publish(t, t.editor, { expectedRevision: stale })
      expect(r.status).toBe(409)
      expect(code(r)).toBe('REVISION_CONFLICT')
      expect(body(r).error?.details?.currentRevision).toBe(revision)
    }
    expect(await tables(pool)).toEqual(before)
  })

  it('an invalid draft is 409 DRAFT_NOT_PUBLISHABLE with the issues; nothing is written', async () => {
    const t = await team()
    await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.missing}',
    })
    const before = await tables(pool)
    const r = await publish(t, t.editor, { expectedRevision: 1 })
    expect(r.status).toBe(409)
    expect(code(r)).toBe('DRAFT_NOT_PUBLISHABLE')
    expect(body(r).error?.details?.issues?.map((i) => i.code)).toEqual([
      'ALIAS_NOT_FOUND',
    ])
    expect(await tables(pool)).toEqual(before)
  })

  it('the issue list in the response is capped at 50, with the total in issueCount', async () => {
    const t = await team()
    for (let i = 0; i < 60; i += 1) {
      await putToken(t, t.editor, `semantic.broken.b-${i}`, {
        value: '{primitive.nope}',
      })
    }
    const r = await publish(t, t.editor, { expectedRevision: 60 })
    expect(r.status).toBe(409)
    expect(body(r).error?.details?.issues).toHaveLength(50)
    expect(body(r).error?.details?.issueCount).toBe(60)
  })

  it('a tier violation blocks publishing (a validateDraft RULE: nothing else would notice it)', async () => {
    const t = await team()
    await seedDraft(pool, t) // revision 3
    // resolves and exports fine, but a component may not alias a primitive (ADR 0006)
    await putToken(t, t.editor, 'component.button.border', {
      value: '{primitive.color.blue}',
    })
    const before = await tables(pool)
    const r = await publish(t, t.editor, { expectedRevision: 4 })
    expect(r.status).toBe(409)
    expect(code(r)).toBe('DRAFT_NOT_PUBLISHABLE')
    expect(body(r).error?.details?.issues?.map((i) => i.code)).toEqual([
      'TIER_VIOLATION',
    ])
    expect(await tables(pool)).toEqual(before)
  })

  it('an EMPTY draft is not publishable (EMPTY_DRAFT)', async () => {
    const t = await team()
    const r = await publish(t, t.editor, { expectedRevision: 0 })
    expect(r.status).toBe(409)
    expect(body(r).error?.details?.issues?.map((i) => i.code)).toEqual([
      'EMPTY_DRAFT',
    ])
  })

  it('a primitives-only draft is not publishable (NOTHING_TO_EXPORT), exactly as GET /validate says', async () => {
    const t = await team()
    await putToken(t, t.editor, 'primitive.color.blue', {
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 1] },
    })
    const r = await publish(t, t.editor, { expectedRevision: 1 })
    expect(r.status).toBe(409)
    expect(body(r).error?.details?.issues?.map((i) => i.code)).toEqual([
      'NOTHING_TO_EXPORT',
    ])
    const validate = await request(t.app)
      .get(`/api/orgs/${t.org}/brands/${t.brand}/validate`)
      .set('Cookie', t.editor.cookie)
    expect((validate.body as TokenBody).publishable).toBe(false)
    expect((validate.body as TokenBody).issues?.map((i) => i.code)).toEqual([
      'NOTHING_TO_EXPORT',
    ])
  })

  it('an unchanged draft is 409 NO_CHANGES carrying the EXISTING release number; no row is added', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: revision })
    const before = await tables(pool)
    for (let i = 0; i < 3; i += 1) {
      const r = await publish(t, t.owner, { expectedRevision: revision })
      expect(r.status).toBe(409)
      expect(code(r)).toBe('NO_CHANGES')
      expect(body(r).error?.details?.latestReleaseNumber).toBe(1)
    }
    expect(await tables(pool)).toEqual(before)
  })

  it('a draft change makes publishing possible again, and NO_CHANGES then names release 2', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: revision })
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 })
    expect(
      (await publish(t, t.editor, { expectedRevision: revision + 1 })).status,
    ).toBe(201)
    const again = await publish(t, t.editor, { expectedRevision: revision + 1 })
    expect(code(again)).toBe('NO_CHANGES')
    expect(body(again).error?.details?.latestReleaseNumber).toBe(2)
  })

  it('a deleted token is a change too: the next release has a different snapshot', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    await publish(t, t.editor, { expectedRevision: revision })
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 })
    await deleteToken(t, t.editor, 'semantic.n.x', 4)
    const r = await publish(t, t.editor, { expectedRevision: revision + 2 })
    expect(r.status).toBe(201)
    expect(body(r).release?.sourceRevision).toBe(5)
  })
})

describe('POST /releases: size and count caps (ADR 0015)', () => {
  it('RELEASE_TOO_LARGE: an oversized draft is refused by publish and by GET /validate alike', async () => {
    const t = await team()
    await seedDraft(pool, t)
    // 160 tokens of ~7 KB (raw SQL: the API itself caps a value at 8 KB): ~1.1 MB
    for (let i = 0; i < 160; i += 1) {
      await makeToken(pool, {
        brandId: t.brand,
        path: `semantic.font.f-${i}`,
        type: 'fontFamily',
        value: ['a'.repeat(7000)],
      })
    }
    await pool.query(
      'UPDATE "Brand" SET "draftRevision" = "draftRevision" + 160 WHERE id = $1',
      [t.brand],
    )
    const revision = await revisionOf(pool, t.brand)
    const before = await tables(pool)
    const r = await publish(t, t.editor, { expectedRevision: revision })
    expect(r.status).toBe(409)
    expect(code(r)).toBe('DRAFT_NOT_PUBLISHABLE')
    expect(body(r).error?.details?.issues?.map((i) => i.code)).toEqual([
      'RELEASE_TOO_LARGE',
    ])
    const validate = await request(t.app)
      .get(`/api/orgs/${t.org}/brands/${t.brand}/validate`)
      .set('Cookie', t.editor.cookie)
    expect((validate.body as TokenBody).publishable).toBe(false)
    expect((validate.body as TokenBody).issues?.map((i) => i.code)).toEqual([
      'RELEASE_TOO_LARGE',
    ])
    expect(await tables(pool)).toEqual(before)
  })

  async function withReleases(count: number, sourceRevision: number) {
    const t = await team()
    const revision = await seedDraft(pool, t)
    await pool.query(
      `INSERT INTO "Release"
         ("brandId", "number", "sourceRevision", "snapshot", "css", "cssSha256", "createdById")
       SELECT $1::uuid, n, $3::int, '{}'::jsonb, ':root {}', repeat('a', 64), $2::uuid
       FROM generate_series(1, $4::int) AS n`,
      [t.brand, t.editor.id, sourceRevision, count],
    )
    return { t, revision }
  }

  it(`RELEASE_LIMIT: the ${RELEASE_LIMITS.MAX_RELEASES_PER_BRAND}th release is accepted (exactly at the cap) and the next is 409 with the limit`, async () => {
    const cap = RELEASE_LIMITS.MAX_RELEASES_PER_BRAND
    const { t, revision } = await withReleases(cap - 1, 0)
    const last = await publish(t, t.editor, { expectedRevision: revision })
    expect(last.status).toBe(201)
    expect(body(last).release?.number).toBe(cap)

    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 })
    const before = await tables(pool)
    const over = await publish(t, t.editor, { expectedRevision: revision + 1 })
    expect(over.status).toBe(409)
    expect(code(over)).toBe('RELEASE_LIMIT')
    expect(body(over).error?.details?.limit).toBe(cap)
    expect(await tables(pool)).toEqual(before)
  })

  it('NO_CHANGES is answered before RELEASE_LIMIT (an unchanged draft is not a limit problem)', async () => {
    const cap = RELEASE_LIMITS.MAX_RELEASES_PER_BRAND
    const { t, revision } = await withReleases(cap, 3)
    const r = await publish(t, t.editor, { expectedRevision: revision })
    expect(code(r)).toBe('NO_CHANGES')
    expect(body(r).error?.details?.latestReleaseNumber).toBe(cap)
  })
})

describe('POST /releases: access', () => {
  it.each([
    ['owner', 201],
    ['editor', 201],
    ['viewer', 403],
  ] as const)('a %s gets %i', async (who, status) => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const before = await tables(pool)
    const r = await publish(t, t[who], { expectedRevision: revision })
    expect(r.status).toBe(status)
    if (status === 403) expect(await tables(pool)).toEqual(before)
  })

  it('anonymous is 401; a non-member and a random or malformed brand id are the same 404', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const outsiderOrg = await organization(pool, 'outsider-org')
    const outsider = await person(pool, t.sessions, 'outsider@example.com')
    await join(pool, outsider.id, outsiderOrg, 'OWNER')

    expect(
      (await publish(t, null, { expectedRevision: revision })).status,
    ).toBe(401)
    const nonMember = await publish(t, outsider, { expectedRevision: revision })
    const random = await publish(
      { ...t, brand: '99999999-9999-4999-8999-999999999999' },
      t.owner,
      { expectedRevision: revision },
    )
    const malformed = await publish({ ...t, brand: 'not-a-uuid' }, t.owner, {
      expectedRevision: revision,
    })
    for (const r of [nonMember, random, malformed]) expect(r.status).toBe(404)
    expect(random.body).toEqual(nonMember.body)
    expect(malformed.body).toEqual(nonMember.body)
    expect(await releaseRows(pool, t.brand)).toEqual([])
  })

  it('a request without an allowed Origin is refused before anything happens (CSRF layer)', async () => {
    const t = await team()
    const revision = await seedDraft(pool, t)
    const r = await request(t.app)
      .post(releasesUrl(t))
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send({ expectedRevision: revision })
    expect(r.status).toBe(403)
    expect(await releaseRows(pool, t.brand)).toEqual([])
  })
})

describe('POST /releases: strict body', () => {
  it.each([
    ['an unknown key', { expectedRevision: 0, mode: 'force' }],
    ['a smuggled createdById', { expectedRevision: 0, createdById: 'x' }],
    ['a smuggled sourceRevision', { expectedRevision: 0, sourceRevision: 0 }],
    ['no expectedRevision', {}],
    ['a string revision', { expectedRevision: '3' }],
    ['a negative revision', { expectedRevision: -1 }],
    ['a revision beyond int4', { expectedRevision: 2147483648 }],
    ['a fractional revision', { expectedRevision: 1.5 }],
    ['an array', [{ expectedRevision: 0 }]],
    [
      'a note over 500 characters',
      { expectedRevision: 0, note: 'n'.repeat(501) },
    ],
    ['a non-string note', { expectedRevision: 0, note: 5 }],
  ])('%s is a 400 and nothing is written', async (_name, payload) => {
    const t = await team()
    await seedDraft(pool, t)
    const before = await tables(pool)
    const r = await publish(t, t.editor, payload)
    expect(r.status).toBe(400)
    expect(code(r)).toBe('VALIDATION_ERROR')
    expect(await tables(pool)).toEqual(before)
  })

  it('a JSON null body is a 400 (rejected by the strict JSON parser)', async () => {
    const t = await team()
    await seedDraft(pool, t)
    const r = await publish(t, t.editor, null)
    expect(r.status).toBe(400)
  })

  it('no body at all is a 400 too', async () => {
    const t = await team()
    await seedDraft(pool, t)
    const r = await request(t.app)
      .post(releasesUrl(t))
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
    expect(r.status).toBe(400)
  })
})

describe('POST /releases: the per-user publish rate limit', () => {
  it('blocks the attempt BEFORE any work; refused callers (viewer) do not use up the allowance', async () => {
    const t = await tokenTeam(pool, db, {
      limits: { publish: { limit: 1 } },
    })
    const revision = await seedDraft(pool, t)
    // viewers are refused by the role check, which runs before the limiter
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await publish(t, t.viewer, { expectedRevision: revision })).status,
      ).toBe(403)
    }
    expect(
      (await publish(t, t.editor, { expectedRevision: revision })).status,
    ).toBe(201)
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 })
    const before = await tables(pool)
    const blocked = await publish(t, t.editor, {
      expectedRevision: revision + 1,
    })
    expect(blocked.status).toBe(429)
    expect(code(blocked)).toBe('RATE_LIMITED')
    // the second release was never built
    expect(await tables(pool)).toEqual(before)
    // another user has their own allowance
    expect(
      (await publish(t, t.owner, { expectedRevision: revision + 1 })).status,
    ).toBe(201)
  })
})

describe('POST /releases: waiting policy (ADR 0014 applies)', () => {
  it('behind a held brand lock the publish answers 503 SERVICE_BUSY + Retry-After, within the timeout, and writes nothing', async () => {
    const t = await tokenTeam(pool, db, {
      tokenTiming: { lockTimeoutMs: 300, txTimeoutMs: 3000, maxWaitMs: 1000 },
    })
    const revision = await seedDraft(pool, t)
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      const started = Date.now()
      const r = await publish(t, t.editor, { expectedRevision: revision })
      const elapsed = Date.now() - started
      expect(r.status).toBe(503)
      expect(code(r)).toBe('SERVICE_BUSY')
      expect(r.headers['retry-after']).toBe('1')
      expect(elapsed).toBeGreaterThanOrEqual(250)
      expect(elapsed).toBeLessThan(2000)
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    expect(await releaseRows(pool, t.brand)).toEqual([])
    expect(
      (await publish(t, t.editor, { expectedRevision: revision })).status,
    ).toBe(201)
  })
})

describe('the unique constraint is a backstop that is never a 500', () => {
  const known = (c: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code: c,
      clientVersion: 'test',
      ...(meta === undefined ? {} : { meta }),
    })

  it.each([
    ['Prisma P2002', known('P2002')],
    [
      'SQLSTATE 23505 in code',
      Object.assign(new Error('x'), { code: '23505' }),
    ],
    ['SQLSTATE 23505 nested', new Error('w', { cause: { code: '23505' } })],
    [
      'Prisma raw-query error carrying 23505',
      known('P2010', { code: '23505' }),
    ],
  ])('isUniqueViolation recognizes %s', (_label, error) => {
    expect(isUniqueViolation(error)).toBe(true)
  })

  it.each([
    ['another Prisma code', known('P2025')],
    ['a plain error', new Error('nope')],
    ['undefined', undefined],
    ['text', 'P2002'],
  ])('isUniqueViolation does not match %s', (_label, error) => {
    expect(isUniqueViolation(error)).toBe(false)
  })
})
