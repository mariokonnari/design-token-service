import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { LIMITS } from '../../src/tokens/validateWrite'
import { put } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import {
  COLOR,
  DIMENSION,
  deleteToken,
  getTokens,
  putToken,
  revisionOf,
  tokenRows,
  tokenTeam,
  tokensUrl,
  type TokenBody,
} from '../support/tokenFixture'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const team = () => tokenTeam(pool, db)
const body = (r: request.Response) => r.body as TokenBody

describe('PUT /tokens/:path: create', () => {
  it.each(['owner', 'editor'] as const)(
    'a %s creates a token (201): version 1, draftRevision +1',
    async (who) => {
      const t = await team()
      const r = await putToken(t, t[who], 'primitive.color.blue', {
        type: 'color',
        value: COLOR,
        description: 'Brand blue',
      })
      expect(r.status).toBe(201)
      expect(body(r).token).toMatchObject({
        path: 'primitive.color.blue',
        type: 'color',
        value: COLOR,
        description: 'Brand blue',
        version: 1,
      })
      expect(body(r).draftRevision).toBe(1)
      expect(body(r).warnings).toEqual([])
      expect(await revisionOf(pool, t.brand)).toBe(1)
      expect(await tokenRows(pool, t.brand)).toHaveLength(1)
    },
  )

  it('an alias needs no type and is stored with a NULL type', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.blue}',
    })
    expect(r.status).toBe(201)
    expect(body(r).token).toMatchObject({
      type: null,
      value: '{primitive.color.blue}',
    })
    expect(await tokenRows(pool, t.brand)).toEqual([
      {
        path: 'semantic.color.action',
        type: null,
        value: '{primitive.color.blue}',
        version: 1,
      },
    ])
  })

  it('an alias to a token that does not exist is ACCEPTED (drafts may be invalid)', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.missing}',
    })
    expect(r.status).toBe(201)
  })

  it('a token outside the three tiers is ACCEPTED too (only /validate reports it)', async () => {
    const t = await team()
    expect(
      (await putToken(t, t.editor, 'loose', { type: 'number', value: 1 }))
        .status,
    ).toBe(201)
  })

  it('warnings (HEX_MISMATCH) are returned and the token is stored', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'primitive.color.x', {
      type: 'color',
      value: { ...COLOR, hex: '#ffffff' },
    })
    expect(r.status).toBe(201)
    expect(body(r).warnings?.map((w) => w.code)).toEqual(['HEX_MISMATCH'])
  })

  it('a viewer gets 403 and nothing is written', async () => {
    const t = await team()
    const r = await putToken(t, t.viewer, 'primitive.color.x', {
      type: 'color',
      value: COLOR,
    })
    expect(r.status).toBe(403)
    expect(await tokenRows(pool, t.brand)).toEqual([])
    expect(await revisionOf(pool, t.brand)).toBe(0)
  })
})

describe('PUT /tokens/:path: update with expectedVersion (optimistic concurrency)', () => {
  async function withToken() {
    const t = await team()
    await putToken(t, t.owner, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
    })
    return t
  }

  it('updating an existing token REQUIRES expectedVersion (409 VERSION_REQUIRED, with the current version)', async () => {
    const t = await withToken()
    const r = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: { value: 8, unit: 'px' },
    })
    expect(r.status).toBe(409)
    expect(body(r).error?.code).toBe('VERSION_REQUIRED')
    expect(body(r).error?.details?.currentVersion).toBe(1)
    expect((await tokenRows(pool, t.brand))[0]?.value).toEqual(DIMENSION)
    expect(await revisionOf(pool, t.brand)).toBe(1)
  })

  it('the right version updates: version +1, draftRevision +1, 200', async () => {
    const t = await withToken()
    const r = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: { value: 8, unit: 'px' },
      expectedVersion: 1,
    })
    expect(r.status).toBe(200)
    expect(body(r).token).toMatchObject({ version: 2, value: { value: 8 } })
    expect(body(r).draftRevision).toBe(2)
    expect((await tokenRows(pool, t.brand))[0]?.version).toBe(2)
  })

  it('a stale version is 409 VERSION_CONFLICT carrying the CURRENT version; nothing changes', async () => {
    const t = await withToken()
    await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: { value: 8, unit: 'px' },
      expectedVersion: 1,
    })
    const stale = await putToken(t, t.owner, 'primitive.space.4', {
      type: 'dimension',
      value: { value: 99, unit: 'px' },
      expectedVersion: 1,
    })
    expect(stale.status).toBe(409)
    expect(body(stale).error?.code).toBe('VERSION_CONFLICT')
    expect(body(stale).error?.details?.currentVersion).toBe(2)
    expect((await tokenRows(pool, t.brand))[0]?.value).toEqual({
      value: 8,
      unit: 'px',
    })
    expect(await revisionOf(pool, t.brand)).toBe(2)
  })

  it('a version from the FUTURE is also a conflict', async () => {
    const t = await withToken()
    const r = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
      expectedVersion: 7,
    })
    expect(r.status).toBe(409)
    expect(body(r).error?.code).toBe('VERSION_CONFLICT')
  })

  it('there is NO no-op detection: re-sending identical data still bumps version and draftRevision', async () => {
    const t = await withToken()
    const r = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
      expectedVersion: 1,
    })
    expect(r.status).toBe(200)
    expect(body(r).token?.version).toBe(2)
    expect(body(r).draftRevision).toBe(2)
  })

  it('expectedVersion on a token that does NOT exist is 409 VERSION_CONFLICT (currentVersion null), and nothing is created', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'primitive.space.9', {
      type: 'dimension',
      value: DIMENSION,
      expectedVersion: 1,
    })
    expect(r.status).toBe(409)
    expect(body(r).error?.code).toBe('VERSION_CONFLICT')
    expect(body(r).error?.details?.currentVersion).toBeNull()
    expect(await tokenRows(pool, t.brand)).toEqual([])
    expect(await revisionOf(pool, t.brand)).toBe(0)
  })

  it('a retried create after a lost response gets VERSION_REQUIRED (the editor must refetch)', async () => {
    const t = await team()
    const first = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
    })
    const retry = await putToken(t, t.editor, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
    })
    expect(first.status).toBe(201)
    expect(retry.status).toBe(409)
    expect(body(retry).error?.code).toBe('VERSION_REQUIRED')
    expect(await revisionOf(pool, t.brand)).toBe(1)
  })
})

describe('PUT /tokens/:path: the path-conflict rule (a path cannot be both a token and a group)', () => {
  it('creating a child of an existing token is 409 PATH_CONFLICT', async () => {
    const t = await team()
    await putToken(t, t.editor, 'semantic.color', { type: 'number', value: 1 })
    const r = await putToken(t, t.editor, 'semantic.color.action', {
      type: 'number',
      value: 2,
    })
    expect(r.status).toBe(409)
    expect(body(r).error?.code).toBe('PATH_CONFLICT')
    expect(body(r).error?.details?.['conflictsWith']).toBe('semantic.color')
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
    expect(await revisionOf(pool, t.brand)).toBe(1)
  })

  it('creating a token at an existing GROUP path is 409 PATH_CONFLICT', async () => {
    const t = await team()
    await putToken(t, t.editor, 'semantic.color.action', {
      type: 'number',
      value: 2,
    })
    const r = await putToken(t, t.editor, 'semantic.color', {
      type: 'number',
      value: 1,
    })
    expect(r.status).toBe(409)
    expect(body(r).error?.code).toBe('PATH_CONFLICT')
    expect(body(r).error?.details?.['conflictsWith']).toBe(
      'semantic.color.action',
    )
  })

  it('a path that only SHARES A PREFIX STRING is not a conflict (a vs ab, a.b vs a.bc)', async () => {
    const t = await team()
    await putToken(t, t.editor, 'a', { type: 'number', value: 1 })
    expect(
      (await putToken(t, t.editor, 'ab', { type: 'number', value: 1 })).status,
    ).toBe(201)
    expect(
      (await putToken(t, t.editor, 'ab.c', { type: 'number', value: 1 }))
        .status,
    ).toBe(409) // ab IS a token
    expect(
      (await putToken(t, t.editor, 'ac.d', { type: 'number', value: 1 }))
        .status,
    ).toBe(201)
    expect(
      (await putToken(t, t.editor, 'ac.dd', { type: 'number', value: 1 }))
        .status,
    ).toBe(201)
  })

  it('updating a token that already has a group-free path is unaffected', async () => {
    const t = await team()
    await putToken(t, t.editor, 'a.b', { type: 'number', value: 1 })
    const r = await putToken(t, t.editor, 'a.b', {
      type: 'number',
      value: 2,
      expectedVersion: 1,
    })
    expect(r.status).toBe(200)
  })
})

describe('PUT /tokens/:path: validation (400, with issues)', () => {
  it.each([
    ['MISSING_TYPE', 'a.b', { value: 1 }],
    ['UNSUPPORTED_TYPE', 'a.b', { type: 'gradient', value: 1 }],
    ['INVALID_VALUE', 'a.b', { type: 'number', value: 'x' }],
    ['INVALID_VALUE', 'a.b', { type: 'color', value: { colorSpace: 'srgb' } }],
    ['INVALID_VALUE', 'a.b', { value: '{Bad Alias}' }],
    ['INVALID_VALUE', 'a.b', { type: 'number', value: null }],
    ['INVALID_NAME', 'A.b', { type: 'number', value: 1 }],
    ['INVALID_NAME', 'a..b', { type: 'number', value: 1 }],
    ['INVALID_NAME', 'a.b_c', { type: 'number', value: 1 }],
    ['INVALID_NAME', '__proto__', { type: 'number', value: 1 }],
    ['INVALID_NAME', 'primitive.constructor', { type: 'number', value: 1 }],
    ['INVALID_NAME', 'prototype.x', { type: 'number', value: 1 }],
  ])('%s for %s', async (code, path, payload) => {
    const t = await team()
    const r = await putToken(t, t.editor, path, payload)
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('INVALID_TOKEN')
    const issues = body(r).error?.details?.issues ?? []
    expect(issues.map((i) => i.code)).toContain(code)
    for (const issue of issues) {
      expect(typeof issue.code).toBe('string')
      expect(typeof issue.path).toBe('string')
      expect(typeof issue.message).toBe('string')
    }
    expect(await tokenRows(pool, t.brand)).toEqual([])
    expect(await revisionOf(pool, t.brand)).toBe(0)
  })

  it.each([
    ['id', { id: 'x' }],
    ['brandId', { brandId: 'x' }],
    ['organizationId', { organizationId: 'x' }],
    ['version', { version: 5 }],
    ['path', { path: 'other.path' }],
    ['draftRevision', { draftRevision: 5 }],
  ])('an unknown key (%s) is 400 and nothing is written', async (_k, extra) => {
    const t = await team()
    const r = await putToken(t, t.editor, 'a.b', {
      type: 'number',
      value: 1,
      ...extra,
    })
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('VALIDATION_ERROR')
    expect(await tokenRows(pool, t.brand)).toEqual([])
  })

  it('a body without `value` is 400 (a literal can never be "nothing")', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'a.b', { type: 'number' })
    expect(r.status).toBe(400)
    expect(await tokenRows(pool, t.brand)).toEqual([])
  })

  it('a __proto__ key in the body is 400', async () => {
    const t = await team()
    const r = await request(t.app)
      .put(tokensUrl(t, '/a.b'))
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send('{"type":"number","value":1,"__proto__":{"x":1}}')
    expect(r.status).toBe(400)
  })

  it.each([
    ['0', 0],
    ['negative', -1],
    ['fraction', 1.5],
    ['string', '1'],
    ['null', null],
    ['2147483648 (over int4)', 2147483648],
    ['99999999999', 99999999999],
  ])('expectedVersion %s is 400, never a 500', async (_label, version) => {
    const t = await team()
    const r = await putToken(t, t.editor, 'a.b', {
      type: 'number',
      value: 1,
      expectedVersion: version,
    })
    expect(r.status).toBe(400)
    expect(body(r).error?.code).toBe('VALIDATION_ERROR')
  })

  it('expectedVersion 2147483647 (the int4 maximum) is accepted by the schema (and conflicts: no such token)', async () => {
    const t = await team()
    const r = await putToken(t, t.editor, 'a.b', {
      type: 'number',
      value: 1,
      expectedVersion: 2147483647,
    })
    expect(r.status).toBe(409)
  })

  it('1e999 (JSON.parse gives Infinity) is rejected for number, dimension and color, and NEVER stored as null', async () => {
    const t = await team()
    const send = (path: string, json: string) =>
      request(t.app)
        .put(tokensUrl(t, `/${path}`))
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', t.editor.cookie)
        .set('Content-Type', 'application/json')
        .send(json)
    for (const [path, json] of [
      ['a.n', '{"type":"number","value":1e999}'],
      ['a.d', '{"type":"dimension","value":{"value":1e999,"unit":"px"}}'],
      [
        'a.c',
        '{"type":"color","value":{"colorSpace":"srgb","components":[1e999,0,0]}}',
      ],
      ['a.w', '{"type":"fontWeight","value":1e999}'],
    ] as const) {
      const r = await send(path, json)
      expect(r.status, path).toBe(400)
    }
    expect(await tokenRows(pool, t.brand)).toEqual([])
    const nulls = await pool.query(
      `SELECT 1 FROM "Token" WHERE "value" = 'null'::jsonb`,
    )
    expect(nulls.rowCount).toBe(0)
  })

  it('a malformed brand id is 404, and a bad JSON body is 400 INVALID_JSON', async () => {
    const t = await team()
    const r = await put(
      request(t.app),
      `/api/orgs/${t.org}/brands/nope/tokens/a.b`,
      { type: 'number', value: 1 },
    ).set('Cookie', t.editor.cookie)
    expect(r.status).toBe(404)
    const bad = await request(t.app)
      .put(tokensUrl(t, '/a.b'))
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send('{"type":')
    expect(bad.status).toBe(400)
    expect(body(bad).error?.code).toBe('INVALID_JSON')
  })

  it('a FAILED mutation (400 and 409) leaves draftRevision, rows and versions unchanged', async () => {
    const t = await team()
    await putToken(t, t.editor, 'a.b', { type: 'number', value: 1 })
    const before = await tokenRows(pool, t.brand)
    const revision = await revisionOf(pool, t.brand)
    for (const attempt of [
      putToken(t, t.editor, 'a.b', {
        type: 'number',
        value: 'bad',
        expectedVersion: 1,
      }),
      putToken(t, t.editor, 'a.b', {
        type: 'number',
        value: 2,
        expectedVersion: 5,
      }),
      putToken(t, t.editor, 'a.b', { type: 'number', value: 2 }),
      putToken(t, t.editor, 'a.b.c', { type: 'number', value: 2 }),
      deleteToken(t, t.editor, 'a.b', 9),
      deleteToken(t, t.editor, 'zzz', 1),
    ]) {
      expect([400, 404, 409]).toContain((await attempt).status)
    }
    expect(await tokenRows(pool, t.brand)).toEqual(before)
    expect(await revisionOf(pool, t.brand)).toBe(revision)
  })
})

describe('limits', () => {
  it('a path of 200 characters is accepted, 201 is 400', async () => {
    const t = await team()
    const path = `${Array.from({ length: 20 }, () => 'abcdefghi').join('.')}x`
    expect(path).toHaveLength(200)
    expect(
      (await putToken(t, t.editor, path, { type: 'number', value: 1 })).status,
    ).toBe(201)
    expect(
      (await putToken(t, t.editor, `${path}x`, { type: 'number', value: 1 }))
        .status,
    ).toBe(400)
  })

  it('a description of 500 characters is accepted, 501 is 400', async () => {
    const t = await team()
    expect(
      (
        await putToken(t, t.editor, 'a.b', {
          type: 'number',
          value: 1,
          description: 'x'.repeat(500),
        })
      ).status,
    ).toBe(201)
    const r = await putToken(t, t.editor, 'a.c', {
      type: 'number',
      value: 1,
      description: 'x'.repeat(501),
    })
    expect(r.status).toBe(400)
  })

  it('a value of exactly 8192 bytes is accepted, 8193 is 400 (the 16 KB body cap is not what stops it)', async () => {
    const t = await team()
    const sized = (bytes: number) => ({
      type: 'fontFamily',
      value: ['x'.repeat(bytes - 4)],
    })
    expect((await putToken(t, t.editor, 'a.big', sized(8192))).status).toBe(201)
    const r = await putToken(t, t.editor, 'a.bigger', sized(8193))
    expect(r.status).toBe(400)
    expect(
      body(r).error?.details?.issues?.some((i) => i.field === 'value'),
    ).toBe(true)
  })

  it('the 2001st token is 409 TOKEN_LIMIT; updating and deleting at the limit still work', async () => {
    const t = await team()
    await pool.query(
      `INSERT INTO "Token" ("brandId", path, type, value)
       SELECT $1, 'bulk.t' || g, 'number', to_jsonb(g) FROM generate_series(1, $2) g`,
      [t.brand, LIMITS.MAX_TOKENS_PER_BRAND],
    )
    const create = await putToken(t, t.editor, 'bulk.extra', {
      type: 'number',
      value: 1,
    })
    expect(create.status).toBe(409)
    expect(body(create).error?.code).toBe('TOKEN_LIMIT')
    const update = await putToken(t, t.editor, 'bulk.t1', {
      type: 'number',
      value: 5,
      expectedVersion: 1,
    })
    expect(update.status).toBe(200)
    const removal = await deleteToken(t, t.editor, 'bulk.t2', 1)
    expect(removal.status).toBe(200)
    const again = await putToken(t, t.editor, 'bulk.extra', {
      type: 'number',
      value: 1,
    })
    expect(again.status).toBe(201)
  })
})

describe('DELETE /tokens/:path?expectedVersion=N', () => {
  async function withToken() {
    const t = await team()
    await putToken(t, t.owner, 'primitive.space.4', {
      type: 'dimension',
      value: DIMENSION,
    })
    return t
  }

  it.each(['owner', 'editor'] as const)(
    'a %s deletes with the right version',
    async (who) => {
      const t = await withToken()
      const r = await deleteToken(t, t[who], 'primitive.space.4', 1)
      expect(r.status).toBe(200)
      expect(body(r).draftRevision).toBe(2)
      expect(await tokenRows(pool, t.brand)).toEqual([])
      expect(await revisionOf(pool, t.brand)).toBe(2)
    },
  )

  it('a viewer gets 403 and nothing is deleted', async () => {
    const t = await withToken()
    expect(
      (await deleteToken(t, t.viewer, 'primitive.space.4', 1)).status,
    ).toBe(403)
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('a missing token is 404; a stale version is 409 VERSION_CONFLICT with the current version', async () => {
    const t = await withToken()
    expect(
      (await deleteToken(t, t.editor, 'primitive.space.9', 1)).status,
    ).toBe(404)
    const stale = await deleteToken(t, t.editor, 'primitive.space.4', 3)
    expect(stale.status).toBe(409)
    expect(body(stale).error?.code).toBe('VERSION_CONFLICT')
    expect(body(stale).error?.details?.currentVersion).toBe(1)
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('expectedVersion is REQUIRED and bounded: missing, 0, text, 2147483648, 99999999999, repeated, extra query keys are all 400', async () => {
    const t = await withToken()
    for (const query of [
      '',
      '?expectedVersion=',
      '?expectedVersion=0',
      '?expectedVersion=abc',
      '?expectedVersion=1.5',
      '?expectedVersion=-1',
      '?expectedVersion=2147483648',
      '?expectedVersion=99999999999',
      '?expectedVersion=1&expectedVersion=1',
      '?expectedVersion=1&force=1',
    ]) {
      const r = await request(t.app)
        .delete(tokensUrl(t, `/primitive.space.4${query}`))
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', t.editor.cookie)
      expect(r.status, query).toBe(400)
    }
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('an invalid path is 404 (it cannot exist)', async () => {
    const t = await withToken()
    expect((await deleteToken(t, t.editor, 'Not.Valid', 1)).status).toBe(404)
  })

  it('aliases pointing at a deleted token are NOT blocked', async () => {
    const t = await team()
    await putToken(t, t.editor, 'primitive.color.blue', {
      type: 'color',
      value: COLOR,
    })
    await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.blue}',
    })
    const r = await deleteToken(t, t.editor, 'primitive.color.blue', 1)
    expect(r.status).toBe(200)
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('a DELETE with a body is rejected (the version travels in the query string)', async () => {
    const t = await withToken()
    const r = await request(t.app)
      .delete(tokensUrl(t, '/primitive.space.4?expectedVersion=1'))
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', t.editor.cookie)
      .set('Content-Type', 'application/json')
      .send({ expectedVersion: 1, extra: true })
    expect(r.status).toBe(400)
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })
})

describe('GET /tokens and GET /tokens/tree: any member, no lock', () => {
  async function seeded() {
    const t = await team()
    for (const [path, payload] of [
      ['primitive.space.1000', { type: 'dimension', value: DIMENSION }],
      ['primitive.space.100', { type: 'dimension', value: DIMENSION }],
      ['primitive.space.4', { type: 'dimension', value: DIMENSION }],
      ['primitive.color.blue', { type: 'color', value: COLOR }],
      ['semantic.color.action', { value: '{primitive.color.blue}' }],
    ] as const) {
      expect((await putToken(t, t.editor, path, payload)).status).toBe(201)
    }
    return t
  }

  it.each(['owner', 'editor', 'viewer'] as const)(
    'a %s reads the draft, sorted with comparePaths (numeric segments numerically), with draftRevision',
    async (who) => {
      const t = await seeded()
      const r = await getTokens(t, t[who])
      expect(r.status).toBe(200)
      expect(body(r).draftRevision).toBe(5)
      expect(body(r).tokens?.map((x) => x.path)).toEqual([
        'primitive.color.blue',
        'primitive.space.4',
        'primitive.space.100',
        'primitive.space.1000',
        'semantic.color.action',
      ])
    },
  )

  it('an empty draft is { draftRevision: 0, tokens: [] }', async () => {
    const t = await team()
    const r = await getTokens(t, t.viewer)
    expect(body(r)).toEqual({ draftRevision: 0, tokens: [] })
  })

  it('the tree is a nested DTCG object built with nest()', async () => {
    const t = await seeded()
    const r = await getTokens(t, t.viewer, '/tree')
    expect(r.status).toBe(200)
    expect(body(r).draftRevision).toBe(5)
    expect(body(r).issues).toEqual([])
    expect(body(r).tree).toMatchObject({
      primitive: {
        color: { blue: { $type: 'color', $value: COLOR } },
        space: { '4': { $type: 'dimension' } },
      },
      semantic: { color: { action: { $value: '{primitive.color.blue}' } } },
    })
  })

  it('an unmappable stored row is reported in the tree, excluded from it, and still listed raw', async () => {
    const t = await seeded()
    await pool.query(
      `INSERT INTO "Token" ("brandId", path, type, value) VALUES ($1, 'broken.row', 'number', '"not a number"')`,
      [t.brand],
    )
    const tree = await getTokens(t, t.viewer, '/tree')
    expect(tree.status).toBe(200)
    expect(body(tree).issues?.map((i) => [i.code, i.path])).toEqual([
      ['UNMAPPABLE_ROW', 'broken.row'],
    ])
    expect(JSON.stringify(body(tree).tree)).not.toContain('broken')
    const list = await getTokens(t, t.viewer)
    expect(body(list).tokens?.map((x) => x.path)).toContain('broken.row')
    // and it can be deleted
    expect((await deleteToken(t, t.editor, 'broken.row', 1)).status).toBe(200)
  })
})
