import request from 'supertest'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { makeBrand } from '../db/helpers'
import { post } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import { join, organization, person } from '../support/orgFixture'
import {
  COLOR,
  deleteToken,
  getTokens,
  putToken,
  revisionOf,
  tokenRows,
  tokenTeam,
  tokensUrl,
  type TokenBody,
  type TokenTeam,
} from '../support/tokenFixture'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const importUrl = (t: { org: string; brand: string }) => tokensUrl(t, '/import')
const body = (r: request.Response) => r.body as TokenBody

function doImport(t: TokenTeam, who: { cookie: string }, payload: unknown) {
  return post(request(t.app), importUrl(t), payload).set('Cookie', who.cookie)
}

/** Raw JSON text, for bodies JSON.stringify cannot build (1e999, __proto__, huge). */
function rawImport(t: TokenTeam, who: { cookie: string } | null, json: string) {
  let test = request(t.app)
    .post(importUrl(t))
    .set('Origin', ALLOWED_ORIGIN)
    .set('Content-Type', 'application/json')
  if (who !== null) test = test.set('Cookie', who.cookie)
  return test.send(json)
}

const tree = (tokens: Record<string, unknown>) => ({
  primitive: { color: tokens },
})
const swatch = { $type: 'color', $value: COLOR }

async function snapshot(t: TokenTeam) {
  return {
    rows: await tokenRows(pool, t.brand),
    revision: await revisionOf(pool, t.brand),
  }
}

describe('POST /tokens/import: replace mode', () => {
  it.each(['owner', 'editor'] as const)(
    'a %s replaces the whole draft atomically; draftRevision +1',
    async (who) => {
      const t = await tokenTeam(pool, db)
      await putToken(t, t.editor, 'old.one', { type: 'number', value: 1 })
      await putToken(t, t.editor, 'old.two', { type: 'number', value: 2 })
      const r = await doImport(t, t[who], {
        tree: tree({ blue: swatch, red: swatch }),
        expectedRevision: 2,
      })
      expect(r.status).toBe(200)
      expect(body(r)).toMatchObject({
        draftRevision: 3,
        count: 2,
        warnings: [],
      })
      const rows = await tokenRows(pool, t.brand)
      expect(rows.map((x) => x.path)).toEqual([
        'primitive.color.blue',
        'primitive.color.red',
      ])
      expect(await revisionOf(pool, t.brand)).toBe(3)
    },
  )

  it('a viewer gets 403 and nothing changes', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'old.one', { type: 'number', value: 1 })
    const before = await snapshot(t)
    const r = await doImport(t, t.viewer, {
      tree: tree({ blue: swatch }),
      expectedRevision: 1,
    })
    expect(r.status).toBe(403)
    expect(await snapshot(t)).toEqual(before)
  })

  it('importing into an EMPTY brand works with expectedRevision 0', async () => {
    const t = await tokenTeam(pool, db)
    const r = await doImport(t, t.editor, {
      tree: tree({ blue: swatch }),
      expectedRevision: 0,
    })
    expect(r.status).toBe(200)
    expect(body(r).draftRevision).toBe(1)
  })

  it('warnings are returned and the import still succeeds', async () => {
    const t = await tokenTeam(pool, db)
    const r = await doImport(t, t.editor, {
      tree: tree({
        x: {
          $type: 'color',
          $value: { ...COLOR, hex: '#ffffff' },
          $extensions: { vendor: 1 },
        },
      }),
      expectedRevision: 0,
    })
    expect(r.status).toBe(200)
    expect(
      body(r)
        .warnings?.map((w) => w.code)
        .sort(),
    ).toEqual(['HEX_MISMATCH', 'UNSUPPORTED_FEATURE'])
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('a path that survives the import gets version+1 (a stale editor can NOT match its old version); new paths get the new draftRevision (ADR 0014, ABA)', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'primitive.color.blue', {
      type: 'color',
      value: COLOR,
    })
    await doImport(t, t.editor, {
      tree: tree({ blue: swatch, red: swatch }),
      expectedRevision: 1,
    })
    const rows = await tokenRows(pool, t.brand)
    expect(rows.map((x) => [x.path, x.version])).toEqual([
      ['primitive.color.blue', 2],
      ['primitive.color.red', 2], // the import is revision 2
    ])
    const stale = await putToken(t, t.editor, 'primitive.color.blue', {
      type: 'color',
      value: COLOR,
      expectedVersion: 1,
    })
    expect(stale.status).toBe(409)
  })

  it('the imported draft reads back as the same tree', async () => {
    const t = await tokenTeam(pool, db)
    await doImport(t, t.editor, {
      tree: {
        primitive: { color: { blue: { ...swatch, $description: 'Blue' } } },
        semantic: { color: { action: { $value: '{primitive.color.blue}' } } },
      },
      expectedRevision: 0,
    })
    const read = await getTokens(t, t.viewer, '/tree')
    expect(body(read).tree).toEqual({
      primitive: { color: { blue: { ...swatch, $description: 'Blue' } } },
      semantic: { color: { action: { $value: '{primitive.color.blue}' } } },
    })
  })
})

describe('POST /tokens/import: refused imports change NOTHING', () => {
  async function seeded() {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'old.one', { type: 'number', value: 1 })
    await putToken(t, t.editor, 'old.two', { type: 'number', value: 2 })
    return t
  }

  it.each([
    ['a bad name', tree({ 'Bad Name': swatch }), 'INVALID_IMPORT'],
    ['a missing type', tree({ x: { $value: 1 } }), 'INVALID_IMPORT'],
    [
      'an invalid value',
      tree({ x: { $type: 'number', $value: 'n' } }),
      'INVALID_IMPORT',
    ],
    ['an empty import', {}, 'INVALID_IMPORT'],
    ['an empty group only', { primitive: {} }, 'INVALID_IMPORT'],
    ['a non-object tree', [], 'INVALID_IMPORT'],
  ])('%s is 400 %s', async (_label, payload, code) => {
    const t = await seeded()
    const before = await snapshot(t)
    const r = await doImport(t, t.editor, {
      tree: payload,
      expectedRevision: 2,
    })
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe(code)
    expect(body(r).error?.details?.issues?.length).toBeGreaterThan(0)
    expect(await snapshot(t)).toEqual(before)
  })

  it('a revision mismatch is 409 REVISION_CONFLICT with the current revision', async () => {
    const t = await seeded()
    const before = await snapshot(t)
    for (const stale of [0, 1, 3]) {
      const r = await doImport(t, t.editor, {
        tree: tree({ blue: swatch }),
        expectedRevision: stale,
      })
      expect(r.status).toBe(409)
      expect(body(r).error?.code).toBe('REVISION_CONFLICT')
      expect(body(r).error?.details?.currentRevision).toBe(2)
    }
    expect(await snapshot(t)).toEqual(before)
  })

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fraction', 1.5],
    ['string', '2'],
    ['null', null],
    ['2147483648 (over int4)', 2147483648],
    ['99999999999', 99999999999],
  ])(
    'expectedRevision %s is 400, never a 500',
    async (_label, expectedRevision) => {
      const t = await seeded()
      const before = await snapshot(t)
      const r = await doImport(t, t.editor, {
        tree: tree({ blue: swatch }),
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      })
      expect(r.status).toBe(400)
      expect(await snapshot(t)).toEqual(before)
    },
  )

  it('expectedRevision 2147483647 (the int4 maximum) is accepted by the schema (and conflicts)', async () => {
    const t = await seeded()
    const r = await doImport(t, t.editor, {
      tree: tree({ blue: swatch }),
      expectedRevision: 2147483647,
    })
    expect(r.status).toBe(409)
  })

  it.each([
    ['mode', { mode: 'merge' }],
    ['brandId', { brandId: 'x' }],
    ['organizationId', { organizationId: 'x' }],
    ['draftRevision', { draftRevision: 3 }],
  ])(
    'an unknown key (%s) is 400: replace is the only mode',
    async (_k, extra) => {
      const t = await seeded()
      const before = await snapshot(t)
      const r = await doImport(t, t.editor, {
        tree: tree({ blue: swatch }),
        expectedRevision: 2,
        ...extra,
      })
      expect(r.status).toBe(400)
      expect(body(r).error?.code).toBe('VALIDATION_ERROR')
      expect(await snapshot(t)).toEqual(before)
    },
  )

  it('a missing tree is 400', async () => {
    const t = await seeded()
    const r = await doImport(t, t.editor, { expectedRevision: 2 })
    expect(r.status).toBe(400)
  })

  it('1e999 in a number or dimension is 400 and nothing is stored (not even as null)', async () => {
    const t = await seeded()
    const before = await snapshot(t)
    for (const json of [
      '{"tree":{"p":{"n":{"$type":"number","$value":1e999}}},"expectedRevision":2}',
      '{"tree":{"p":{"d":{"$type":"dimension","$value":{"value":1e999,"unit":"px"}}}},"expectedRevision":2}',
    ]) {
      expect((await rawImport(t, t.editor, json)).status).toBe(400)
    }
    expect(await snapshot(t)).toEqual(before)
    const nulls = await pool.query(
      `SELECT 1 FROM "Token" WHERE "value" = 'null'::jsonb`,
    )
    expect(nulls.rowCount).toBe(0)
  })
})

describe('POST /tokens/import: the SAME limits as PUT, per token and per brand', () => {
  // One team per test; each call gets its own EMPTY brand (revision 0).
  let team: TokenTeam | undefined
  async function importOne(token: Record<string, unknown>, name = 'x') {
    team ??= await tokenTeam(pool, db)
    const brand = String(
      (
        await makeBrand(pool, {
          organizationId: team.org,
          slug: `one-${Math.random().toString(36).slice(2, 10)}`,
        })
      )['id'],
    )
    const t = { ...team, brand }
    const r = await doImport(t, t.editor, {
      tree: tree({ [name]: token }),
      expectedRevision: 0,
    })
    return { t, r }
  }

  beforeEach(() => {
    team = undefined
  })

  it('path: 200 characters pass, 201 are 400', async () => {
    const total = (n: number) => 'a'.repeat(n - 'primitive.color.'.length)
    expect(
      (await importOne({ $type: 'number', $value: 1 }, total(200))).r.status,
    ).toBe(200)
    const { t, r } = await importOne({ $type: 'number', $value: 1 }, total(201))
    expect(r.status).toBe(400)
    expect(await tokenRows(pool, t.brand)).toEqual([])
  })

  it('description: 500 pass, 501 are 400', async () => {
    expect(
      (
        await importOne({
          $type: 'number',
          $value: 1,
          $description: 'x'.repeat(500),
        })
      ).r.status,
    ).toBe(200)
    const { r } = await importOne({
      $type: 'number',
      $value: 1,
      $description: 'x'.repeat(501),
    })
    expect(r.status).toBe(400)
  })

  it('value: 8192 bytes pass, 8193 are 400', async () => {
    const sized = (bytes: number) => ({
      $type: 'fontFamily',
      $value: ['x'.repeat(bytes - 4)],
    })
    expect((await importOne(sized(8192))).r.status).toBe(200)
    expect((await importOne(sized(8193))).r.status).toBe(400)
  })

  it('2000 tokens pass, 2001 are 400 (the whole import, nothing stored)', async () => {
    const many = (n: number) => {
      const tokens: Record<string, unknown> = {}
      for (let i = 0; i < n; i++)
        tokens[`t${i}`] = { $type: 'number', $value: i }
      return tree(tokens)
    }
    const t = await tokenTeam(pool, db)
    const ok = await doImport(t, t.editor, {
      tree: many(2000),
      expectedRevision: 0,
    })
    expect(ok.status).toBe(200)
    expect(body(ok).count).toBe(2000)
    expect(await tokenRows(pool, t.brand)).toHaveLength(2000)
    const over = await doImport(t, t.editor, {
      tree: many(2001),
      expectedRevision: 1,
    })
    expect(over.status).toBe(400)
    expect(await tokenRows(pool, t.brand)).toHaveLength(2000)
    expect(await revisionOf(pool, t.brand)).toBe(1)
  })
})

describe('POST /tokens/import: hostile trees are 400, never 500, and fast', () => {
  const wrap = (treeJson: string, revision = 0) =>
    `{"tree":${treeJson},"expectedRevision":${revision}}`

  it('a 50,000-level tree (about 300 KB, under the 512 KB cap) is 400 within a second', async () => {
    const t = await tokenTeam(pool, db)
    const json = wrap(
      `${'{"a":'.repeat(50_000)}{"$type":"number","$value":1}${'}'.repeat(50_000)}`,
    )
    expect(Buffer.byteLength(json)).toBeLessThan(512 * 1024)
    expect(Buffer.byteLength(json)).toBeGreaterThan(16 * 1024)
    const started = Date.now()
    const r = await rawImport(t, t.editor, json)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('INVALID_IMPORT')
    expect(await tokenRows(pool, t.brand)).toEqual([])
  })

  it('the deepest body that fits in 512 KB is 400 too (INVALID_JSON if JSON.parse itself gives up)', async () => {
    const t = await tokenTeam(pool, db)
    const levels = 85_000
    const json = wrap(`${'{"a":'.repeat(levels)}1${'}'.repeat(levels)}`)
    expect(Buffer.byteLength(json)).toBeLessThan(512 * 1024)
    const r = await rawImport(t, t.editor, json)
    expect([400]).toContain(r.status)
    expect(['INVALID_IMPORT', 'INVALID_JSON']).toContain(body(r).error?.code)
  })

  it('if JSON.parse itself throws a RangeError (stack exhaustion), the answer is still 400 INVALID_JSON with a fixed message, never 500', async () => {
    // Node 24 parses even 1,000,000 levels, so this cannot be provoked with real
    // input; the mapping is pinned by making JSON.parse throw for one marked body.
    const t = await tokenTeam(pool, db)
    const real = JSON.parse.bind(JSON)
    const spy = vi
      .spyOn(JSON, 'parse')
      .mockImplementation(
        (text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
          if (typeof text === 'string' && text.includes('RANGE_MARKER')) {
            throw new RangeError('Maximum call stack size exceeded')
          }
          return real(text, reviver) as unknown
        },
      )
    try {
      const r = await rawImport(
        t,
        t.editor,
        '{"tree":{"RANGE_MARKER":{}},"expectedRevision":0}',
      )
      expect(r.status).toBe(400)
      expect(body(r).error?.code).toBe('INVALID_JSON')
      expect(JSON.stringify(r.body)).not.toMatch(/stack|RangeError/i)
    } finally {
      spy.mockRestore()
    }
    expect(await tokenRows(pool, t.brand)).toEqual([])
  })

  it('10,000+ empty groups are 400', async () => {
    const t = await tokenTeam(pool, db)
    const groups = Array.from({ length: 10_001 }, (_, i) => `"g${i}":{}`).join(
      ',',
    )
    const json = wrap(`{${groups}}`)
    expect(Buffer.byteLength(json)).toBeLessThan(512 * 1024)
    const r = await rawImport(t, t.editor, json)
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('INVALID_IMPORT')
  })

  it.each(['__proto__', 'constructor', 'prototype'])(
    'a key named %s is 400, at the top and nested',
    async (key) => {
      const t = await tokenTeam(pool, db)
      for (const json of [
        wrap(`{"${key}":{"$type":"number","$value":1}}`),
        wrap(`{"primitive":{"${key}":{"$type":"number","$value":1}}}`),
        wrap(`{"primitive":{"x":{"$type":"number","$value":1}},"${key}":1}`),
      ]) {
        const r = await rawImport(t, t.editor, json)
        expect(r.status, json).toBe(400)
      }
      expect(await tokenRows(pool, t.brand)).toEqual([])
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    },
  )
})

describe('POST /tokens/import: the 512 KB cap sits next to the global 16 KB cap', () => {
  it('a 17 KB+ import body is ACCEPTED (the per-route parser replaced the 16 KB one)', async () => {
    const t = await tokenTeam(pool, db)
    const tokens: Record<string, unknown> = {}
    for (let i = 0; i < 400; i++) {
      tokens[`t${i}`] = {
        $type: 'number',
        $value: i,
        $description: 'padding '.repeat(5),
      }
    }
    const json = JSON.stringify({ tree: tree(tokens), expectedRevision: 0 })
    expect(Buffer.byteLength(json)).toBeGreaterThan(16 * 1024)
    const r = await rawImport(t, t.editor, json)
    expect(r.status).toBe(200)
    expect(body(r).count).toBe(400)
  })

  it('a body over 512 KB is 413 PAYLOAD_TOO_LARGE and nothing changes', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'old.one', { type: 'number', value: 1 })
    const before = await snapshot(t)
    const pad = 'x'.repeat(520 * 1024)
    const r = await rawImport(
      t,
      t.editor,
      `{"tree":{"a":{"$type":"number","$value":1,"$description":"${pad}"}},"expectedRevision":1}`,
    )
    expect(r.status).toBe(413)
    expect(body(r).error?.code).toBe('PAYLOAD_TOO_LARGE')
    expect(await snapshot(t)).toEqual(before)
  })

  it('every OTHER route keeps the 16 KB cap (PUT with a 20 KB body is 413)', async () => {
    const t = await tokenTeam(pool, db)
    const r = await request(t.app)
      .put(tokensUrl(t, '/a.b'))
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send(
        `{"type":"number","value":1,"description":"${'x'.repeat(20 * 1024)}"}`,
      )
    expect(r.status).toBe(413)
  })

  it('only the route-table entries that declare bodyLimit skip the global parser', async () => {
    const t = await tokenTeam(pool, db)
    const withLimit = t.routes
      .filter((route) => route.bodyLimit !== undefined)
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
    expect(withLimit).toEqual([
      'POST /api/orgs/:orgId/brands/:brandId/tokens/import',
    ])
    // a lookalike path does NOT get the big limit
    const big = JSON.stringify({ x: 'y'.repeat(20 * 1024) })
    const lookalike = await request(t.app)
      .post(`${importUrl(t)}/extra`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send(big)
    expect(lookalike.status).toBe(413)
    const trailing = await request(t.app)
      .post(`${importUrl(t)}/`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send(big)
    expect(trailing.status).toBe(413) // safe direction: the small cap applies
  })
})

describe('POST /tokens/import: the body is NOT read before authentication and authorization', () => {
  const garbage = `{"tree":${'{"a":'.repeat(60_000)}`.padEnd(400 * 1024, 'x') // ~400 KB, invalid JSON

  it('unauthenticated: 401, not 400/413', async () => {
    const t = await tokenTeam(pool, db)
    expect(Buffer.byteLength(garbage)).toBeGreaterThan(300 * 1024)
    const r = await rawImport(t, null, garbage)
    expect(r.status).toBe(401)
    expect(body(r).error?.code).toBe('UNAUTHENTICATED')
  })

  it('authenticated but NOT a member: 404', async () => {
    const t = await tokenTeam(pool, db)
    const stranger = await person(pool, t.sessions, 'stranger@example.com')
    const r = await rawImport(t, stranger, garbage)
    expect(r.status).toBe(404)
    expect(body(r).error?.code).toBe('NOT_FOUND')
  })

  it('a member of another organization: 404', async () => {
    const t = await tokenTeam(pool, db)
    const other = await organization(pool, 'elsewhere')
    const outsider = await person(pool, t.sessions, 'outsider@example.com')
    await join(pool, outsider.id, other, 'OWNER')
    expect((await rawImport(t, outsider, garbage)).status).toBe(404)
  })

  it('a viewer: 403', async () => {
    const t = await tokenTeam(pool, db)
    expect((await rawImport(t, t.viewer, garbage)).status).toBe(403)
  })

  it('an editor with the same garbage reaches the parser: 413 or 400 INVALID_JSON', async () => {
    const t = await tokenTeam(pool, db)
    const r = await rawImport(t, t.editor, garbage)
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('INVALID_JSON')
  })
})

describe('POST /tokens/import: per-user rate limit, before any parsing', () => {
  it('the 3rd import in the window is 429 RATE_LIMITED, even for a body that would be invalid JSON', async () => {
    const t = await tokenTeam(pool, db, {
      limits: { tokenImport: { limit: 2 } },
    })
    const bad = '{"tree":'
    expect((await rawImport(t, t.editor, bad)).status).toBe(400)
    expect((await rawImport(t, t.editor, bad)).status).toBe(400)
    const limited = await rawImport(t, t.editor, bad)
    expect(limited.status).toBe(429)
    expect(body(limited).error?.code).toBe('RATE_LIMITED')
  })

  it('it is per USER: another member is unaffected', async () => {
    const t = await tokenTeam(pool, db, {
      limits: { tokenImport: { limit: 1 } },
    })
    expect((await rawImport(t, t.editor, '{')).status).toBe(400)
    expect((await rawImport(t, t.editor, '{')).status).toBe(429)
    expect((await rawImport(t, t.owner, '{')).status).toBe(400)
  })

  it('refused callers (401, 403, 404) do not use up a legitimate user’s allowance', async () => {
    const t = await tokenTeam(pool, db, {
      limits: { tokenImport: { limit: 1 } },
    })
    for (let i = 0; i < 5; i++) {
      expect((await rawImport(t, null, '{')).status).toBe(401)
      expect((await rawImport(t, t.viewer, '{')).status).toBe(403)
    }
    expect((await rawImport(t, t.editor, '{')).status).toBe(400)
  })

  it('the default is 10 per 10 minutes', async () => {
    const { DEFAULT_RATE_LIMITS } = await import('../../src/http/rateLimit')
    expect(DEFAULT_RATE_LIMITS.tokenImport).toEqual({
      windowMs: 10 * 60_000,
      limit: 10,
    })
  })
})

describe('POST /tokens/import: an import racing a token PUT serializes (50 iterations)', () => {
  it('every outcome equals ONE order of the two; nothing is half-applied or lost', async () => {
    const t = await tokenTeam(pool, db)
    let importFirst = 0
    let putFirst = 0
    for (let i = 0; i < 50; i++) {
      const brand = String(
        (
          await makeBrand(pool, {
            organizationId: t.org,
            slug: `imp-${i}-${Math.random().toString(36).slice(2, 7)}`,
          })
        )['id'],
      )
      const b = { ...t, brand }
      await putToken(b, t.editor, 'old.one', { type: 'number', value: 1 }) // revision 1

      const [imp, put] = await Promise.all([
        doImport(b, t.owner, {
          tree: tree({ blue: swatch, red: swatch }),
          expectedRevision: 1,
        }),
        putToken(b, t.editor, 'late.arrival', { type: 'number', value: 9 }),
      ])
      const paths = (await tokenRows(pool, brand)).map((r) => r.path)
      expect(put.status, `iteration ${i}`).toBe(201)
      if (imp.status === 200) {
        // import ran first: revision 2, then the PUT: revision 3; the PUT survives
        importFirst++
        expect(paths, `iteration ${i}`).toEqual([
          'late.arrival',
          'primitive.color.blue',
          'primitive.color.red',
        ])
        expect(await revisionOf(pool, brand)).toBe(3)
        expect(body(put).draftRevision).toBe(3)
      } else {
        // the PUT ran first: the import sees revision 2 and is refused whole
        putFirst++
        expect(imp.status, `iteration ${i}`).toBe(409)
        expect(body(imp).error?.code).toBe('REVISION_CONFLICT')
        expect(body(imp).error?.details?.currentRevision).toBe(2)
        expect(paths, `iteration ${i}`).toEqual(['late.arrival', 'old.one'])
        expect(await revisionOf(pool, brand)).toBe(2)
      }
    }
    // not vacuous: report the split (both orders are legal)
    expect(importFirst + putFirst).toBe(50)
  }, 300_000)

  it('two concurrent imports with the same expectedRevision: exactly one wins', async () => {
    const t = await tokenTeam(pool, db)
    for (let i = 0; i < 20; i++) {
      const brand = String(
        (
          await makeBrand(pool, {
            organizationId: t.org,
            slug: `imp2-${i}-${Math.random().toString(36).slice(2, 7)}`,
          })
        )['id'],
      )
      const b = { ...t, brand }
      const [x, y] = await Promise.all([
        doImport(b, t.owner, {
          tree: tree({ a: swatch }),
          expectedRevision: 0,
        }),
        doImport(b, t.editor, {
          tree: tree({ b: swatch }),
          expectedRevision: 0,
        }),
      ])
      expect([x.status, y.status].sort(), `iteration ${i}`).toEqual([200, 409])
      expect(await tokenRows(pool, brand)).toHaveLength(1)
      expect(await revisionOf(pool, brand)).toBe(1)
    }
  }, 300_000)
})

describe('POST /tokens/import: tenancy', () => {
  it('through the wrong parent organization it is the same 404 as any miss', async () => {
    const t = await tokenTeam(pool, db)
    const otherOrg = await organization(pool, 'other')
    await join(pool, t.owner.id, otherOrg, 'OWNER')
    await putToken(t, t.editor, 'old.one', { type: 'number', value: 1 })
    const before = await snapshot(t)
    const wrong = await post(
      request(t.app),
      `/api/orgs/${otherOrg}/brands/${t.brand}/tokens/import`,
      { tree: tree({ blue: swatch }), expectedRevision: 1 },
    ).set('Cookie', t.owner.cookie)
    const miss = await post(
      request(t.app),
      `/api/orgs/${otherOrg}/brands/99999999-9999-4999-8999-999999999999/tokens/import`,
      { tree: tree({ blue: swatch }), expectedRevision: 1 },
    ).set('Cookie', t.owner.cookie)
    expect(wrong.status).toBe(404)
    expect(wrong.body).toEqual(miss.body)
    expect(await snapshot(t)).toEqual(before)
    // and a failed import never leaves a trace in the other direction either
    expect((await deleteToken(t, t.editor, 'old.one', 1)).status).toBe(200)
  })
})
