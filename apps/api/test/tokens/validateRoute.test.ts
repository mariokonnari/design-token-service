import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  brandUrl,
  COLOR,
  putToken,
  tokenTeam,
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
const validate = (
  t: Awaited<ReturnType<typeof team>>,
  who: { cookie: string },
) => request(t.app).get(brandUrl(t, '/validate')).set('Cookie', who.cookie)

async function validDraft() {
  const t = await team()
  await putToken(t, t.editor, 'primitive.color.blue', {
    type: 'color',
    value: COLOR,
  })
  await putToken(t, t.editor, 'semantic.color.action', {
    value: '{primitive.color.blue}',
  })
  return t
}

describe('GET /brands/:brandId/validate', () => {
  it.each(['owner', 'editor', 'viewer'] as const)(
    'a %s gets { draftRevision, publishable, issues }',
    async (who) => {
      const t = await validDraft()
      const r = await validate(t, t[who])
      expect(r.status).toBe(200)
      expect(r.body).toEqual({
        draftRevision: 2,
        publishable: true,
        issues: [],
      })
    },
  )

  it('an empty draft is NOT publishable (EMPTY_DRAFT)', async () => {
    const t = await team()
    const r = await validate(t, t.viewer)
    expect(r.status).toBe(200)
    const body = r.body as TokenBody
    expect(body.draftRevision).toBe(0)
    expect(body.publishable).toBe(false)
    expect(body.issues?.map((i) => i.code)).toEqual(['EMPTY_DRAFT'])
  })

  it('an alias to a missing token', async () => {
    const t = await team()
    await putToken(t, t.editor, 'semantic.color.action', {
      value: '{primitive.color.missing}',
    })
    const body = (await validate(t, t.viewer)).body as TokenBody
    expect(body.publishable).toBe(false)
    expect(body.issues?.map((i) => [i.code, i.path])).toEqual([
      ['ALIAS_NOT_FOUND', 'semantic.color.action'],
    ])
  })

  it('a cycle', async () => {
    const t = await team()
    await putToken(t, t.editor, 'semantic.a', { value: '{semantic.b}' })
    await putToken(t, t.editor, 'semantic.b', { value: '{semantic.a}' })
    const body = (await validate(t, t.viewer)).body as TokenBody
    expect(body.publishable).toBe(false)
    expect(body.issues?.filter((i) => i.code === 'ALIAS_CYCLE')).toHaveLength(2)
  })

  it('a tier violation', async () => {
    const t = await validDraft()
    await putToken(t, t.editor, 'component.button.border', {
      value: '{primitive.color.blue}',
    })
    const body = (await validate(t, t.viewer)).body as TokenBody
    expect(body.publishable).toBe(false)
    expect(body.issues?.map((i) => [i.code, i.path])).toEqual([
      ['TIER_VIOLATION', 'component.button.border'],
    ])
  })

  it('a CSS name collision', async () => {
    const t = await team()
    await putToken(t, t.editor, 'primitive.a.b-c', { type: 'number', value: 1 })
    await putToken(t, t.editor, 'primitive.a-b.c', { type: 'number', value: 2 })
    // (a semantic token keeps the draft exportable: a primitives-only one is NOTHING_TO_EXPORT)
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 3 })
    const body = (await validate(t, t.viewer)).body as TokenBody
    expect(body.publishable).toBe(false)
    expect(body.issues?.map((i) => i.code)).toEqual([
      'CSS_NAME_COLLISION',
      'CSS_NAME_COLLISION',
    ])
  })

  it('a draft containing an unmappable stored row reports it and is not publishable', async () => {
    const t = await validDraft()
    await pool.query(
      `INSERT INTO "Token" ("brandId", path, type, value) VALUES ($1, 'primitive.color.broken', 'color', '"nope"')`,
      [t.brand],
    )
    const r = await validate(t, t.viewer)
    expect(r.status).toBe(200)
    const body = r.body as TokenBody
    expect(body.publishable).toBe(false)
    expect(body.issues?.map((i) => [i.code, i.path])).toEqual([
      ['UNMAPPABLE_ROW', 'primitive.color.broken'],
    ])
  })

  it('does not change anything: draftRevision is the same before and after', async () => {
    const t = await validDraft()
    await validate(t, t.viewer)
    await validate(t, t.owner)
    const row = await pool.query(
      'SELECT "draftRevision" FROM "Brand" WHERE id = $1',
      [t.brand],
    )
    expect(row.rows).toEqual([{ draftRevision: 2 }])
  })
})
