import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerToken } from '../../src/api/types'
import { libraryCoverage } from '../../src/editor/libraryCoverage'
import { STARTER_TOKENS, STARTER_TREE } from '../../src/editor/starter'
import {
  installDialogDouble,
  type DialogDouble,
} from '../../../../packages/ui/test/support/dialogDouble'
import {
  SIGNED_IN,
  apiError,
  brand,
  org,
  renderApp,
  type Handler,
} from '../support/renderApp'

// The token editor on a fake fetch (ADR 0017). jsdom has no layout and loads no CSS,
// so contrast, focus rings, the top layer and the real cascade are covered by the
// browser suite (e2e/editor.spec.ts); here: behavior, wiring and request bodies.

const acme = org()
const summit = brand({ draftRevision: 12 })
const BASE = `/api/orgs/${acme.id}/brands/${summit.id}`
const TOKENS = `${BASE}/tokens`
const ROUTE = `/orgs/${acme.id}/brands/${summit.id}`

const BLUE = { colorSpace: 'srgb', components: [0.145, 0.388, 0.922] }

const row = (over: Partial<ServerToken> & { path: string }): ServerToken => ({
  type: null,
  value: null,
  description: null,
  version: 1,
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
})

const LIST: ServerToken[] = [
  row({
    path: 'component.button.bg',
    value: '{semantic.color.action}',
    version: 5,
  }),
  row({
    path: 'primitive.color.blue-500',
    type: 'color',
    value: BLUE,
    version: 3,
    description: 'The brand blue',
  }),
  row({
    path: 'primitive.space.4',
    type: 'dimension',
    value: { value: 16, unit: 'px' },
    version: 2,
  }),
  row({
    path: 'semantic.color.action',
    value: '{primitive.color.blue-500}',
    version: 4,
  }),
]

function handlers(
  options: {
    role?: 'OWNER' | 'EDITOR' | 'VIEWER'
    tokens?: ServerToken[]
    revision?: number
    extra?: Record<string, Handler>
  } = {},
): Record<string, Handler> {
  const { role = 'OWNER', tokens = LIST, revision = 12, extra = {} } = options
  return {
    ...SIGNED_IN,
    'GET /api/orgs': { body: { organizations: [org({ role })] } },
    [`GET ${BASE}`]: {
      body: { brand: { ...summit, draftRevision: revision } },
    },
    [`GET ${TOKENS}`]: { body: { draftRevision: revision, tokens } },
    ...extra,
  }
}

async function openEditor(
  options: Parameters<typeof handlers>[0] = {},
  route = ROUTE,
) {
  const app = renderApp({ route, handlers: handlers(options) })
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Summit' }),
  ).toBeVisible()
  // the tokens have arrived once the editing column is there
  await screen.findByRole('group', { name: 'Tokens and editing' })
  return app
}

let dialogs: DialogDouble
beforeEach(() => {
  dialogs = installDialogDouble()
})
afterEach(() => {
  cleanup()
  dialogs.restore()
  document.head
    .querySelectorAll('style[data-dts-preview]')
    .forEach((n) => n.remove())
})

/** The tokens-and-editing column; the preview gallery has its own tabs and alerts. */
const left = () => screen.getByRole('group', { name: 'Tokens and editing' })
const tierTabs = () =>
  within(screen.getByRole('tablist', { name: 'Token tiers' })).getAllByRole(
    'tab',
  )
const announcement = () => screen.getByRole('status', { name: 'Page changes' })

const tokenButton = (path: string) =>
  new RegExp(`^${path.replaceAll('.', '\\.')} `)

async function selectToken(
  user: ReturnType<typeof userEvent.setup>,
  path: string,
) {
  await user.click(
    await screen.findByRole('button', { name: tokenButton(path) }),
  )
  return screen.findByRole('region', { name: path })
}

describe('the list', () => {
  it('shows the brand, role, revision and one tab per tier with counts', async () => {
    await openEditor()
    expect(screen.getByText('Owner')).toBeVisible()
    expect(screen.getByText('12')).toBeVisible()
    const tabs = tierTabs()
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Primitive (2)',
      'Semantic (1)',
      'Component (1)',
    ])
  })

  it('keeps every tier panel mounted (aria-controls resolves) but renders list content only in the selected one', async () => {
    const user = userEvent.setup()
    await openEditor()
    const tabs = tierTabs()
    for (const tab of tabs) {
      const id = tab.getAttribute('aria-controls')
      expect(document.getElementById(id ?? '')).not.toBeNull()
    }
    const tierPanels = () =>
      tierTabs().map(
        (tab) =>
          document.getElementById(
            tab.getAttribute('aria-controls') ?? '',
          ) as HTMLElement,
      )
    const panels = tierPanels()
    expect(panels).toHaveLength(3)
    const filled = [...panels].filter((panel) => panel.childElementCount > 0)
    expect(filled).toHaveLength(1)
    expect(
      within(filled[0] as HTMLElement).getByRole('button', {
        name: /primitive\.color\.blue-500/,
      }),
    ).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Semantic (1)' }))
    const after = tierPanels().filter((panel) => panel.childElementCount > 0)
    expect(after).toHaveLength(1)
    expect(
      within(after[0] as HTMLElement).getByRole('button', {
        name: /semantic\.color\.action/,
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: tokenButton('primitive.color.blue-500'),
      }),
    ).toBeNull()
  })

  it('shows every value as TEXT (a hex, a size, an alias), with a decorative swatch', async () => {
    const user = userEvent.setup()
    await openEditor()
    const blue = screen.getByRole('button', {
      name: /primitive\.color\.blue-500/,
    })
    expect(blue).toHaveTextContent('#2563eb')
    expect(blue.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    ).toHaveTextContent('16px')
    await user.click(screen.getByRole('tab', { name: 'Semantic (1)' }))
    expect(
      screen.getByRole('button', { name: /semantic\.color\.action/ }),
    ).toHaveTextContent('{primitive.color.blue-500}')
  })

  it('filters by a search term (text, never a pattern)', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.type(
      screen.getByRole('searchbox', { name: 'Search tokens' }),
      'dimension',
    )
    expect(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /primitive\.color\.blue-500/ }),
    ).toBeNull()
    expect(screen.getByRole('tab', { name: 'Primitive (1)' })).toBeVisible()
    await user.clear(screen.getByRole('searchbox', { name: 'Search tokens' }))
    await user.type(
      screen.getByRole('searchbox', { name: 'Search tokens' }),
      '.*[[(',
    )
    expect(screen.getByText(/no tokens match/i)).toBeVisible()
  })

  it('lists a corrupt stored row, marked unreadable, without breaking the others', async () => {
    await openEditor({
      tokens: [
        ...LIST,
        row({
          path: 'primitive.color.bad',
          type: 'color',
          value: 'red',
          version: 9,
        }),
      ],
    })
    const bad = screen.getByRole('button', { name: /primitive\.color\.bad/ })
    expect(bad).toHaveTextContent(/unreadable/i)
    expect(
      screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
    ).toBeVisible()
  })
})

describe('library coverage', () => {
  it('says how many library tokens the draft defines, as text, and lists the missing ones on demand', async () => {
    const user = userEvent.setup()
    // two of the library's own tokens (the starter template's paths) plus one primitive
    await openEditor({
      tokens: [
        row({ path: 'primitive.color.blue-500', type: 'color', value: BLUE }),
        row({
          path: 'semantic.color.focus-ring',
          value: '{primitive.color.blue-500}',
        }),
        row({
          path: 'component.button.min-size-md',
          type: 'dimension',
          value: { value: 36, unit: 'px' },
        }),
      ],
    })
    const total = libraryCoverage([], STARTER_TOKENS).total
    expect(
      screen.getByText(`Library tokens defined: 2 of ${total}`),
    ).toBeVisible()
    const toggle = screen.getByRole('button', {
      name: /show missing library tokens/i,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('list', { name: /missing library tokens/i }),
    ).toBeNull()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('list', { name: /missing library tokens/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(total - 2)
    expect(within(list).queryByText('semantic.color.focus-ring')).toBeNull()
    expect(within(list).getByText('semantic.color.surface')).toBeVisible()
  })
})

describe('selecting a token and ?token=', () => {
  it('selects with a click, puts the path in the URL, and shows the edit form', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    expect(app.location()).toBe(`${ROUTE}?token=primitive.color.blue-500`)
    expect(
      within(region).getByRole('textbox', { name: /^Color \(hex\)/ }),
    ).toHaveValue('#2563eb')
    expect(
      within(region).getByRole('textbox', { name: /^Description/ }),
    ).toHaveValue('The brand blue')
    expect(
      screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('opens the right tier when the URL names a token in another tier', async () => {
    await openEditor({}, `${ROUTE}?token=component.button.bg`)
    expect(
      await screen.findByRole('region', { name: 'component.button.bg' }),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Component (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('a valid path that is not in the draft is a calm "token not found"', async () => {
    const app = await openEditor({}, `${ROUTE}?token=primitive.nope`)
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Token not found' }),
    ).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /^Path/ })).toBeNull()
    expect(app.unexpected).toEqual([])
  })

  it.each([
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['a 10 KB string', 'x'.repeat(10_240)],
    ['control characters', 'a\u0000b\u0007c'],
    ['encoded slashes', 'a%2Fb'],
    ['a path traversal', '../../etc/passwd'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['an empty segment', 'a..b'],
  ])(
    'a hostile value (%s) shows "token not found" and never crashes',
    async (_label, value) => {
      const app = await openEditor(
        {},
        `${ROUTE}?token=${encodeURIComponent(value)}`,
      )
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Token not found',
        }),
      ).toBeVisible()
      expect(document.querySelector('img')).toBeNull()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Tokens' }),
      ).toBeVisible()
      // the list still works and nothing odd was requested
      expect(
        screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
      ).toBeVisible()
      expect(app.unexpected).toEqual([])
      expect(app.requests.map((r) => `${r.method} ${r.path}`)).not.toContain(
        expect.stringContaining('__proto__'),
      )
    },
  )

  it('"Show all tokens" leaves the not-found state', async () => {
    const user = userEvent.setup()
    const app = await openEditor({}, `${ROUTE}?token=__proto__`)
    await user.click(
      await screen.findByRole('link', { name: /show all tokens/i }),
    )
    expect(app.location()).toBe(ROUTE)
    expect(
      screen.queryByRole('heading', { name: 'Token not found' }),
    ).toBeNull()
  })
})

describe('saving', () => {
  const put = `PUT ${TOKENS}/primitive.color.blue-500`

  it('sends the type, the value and the version it was loaded with, updates the revision and announces it', async () => {
    const user = userEvent.setup()
    const app = await openEditor({
      extra: {
        [put]: {
          body: {
            token: row({
              path: 'primitive.color.blue-500',
              type: 'color',
              value: { colorSpace: 'srgb', components: [1, 0, 0] },
              version: 13,
            }),
            draftRevision: 13,
            warnings: [],
          },
        },
      },
    })
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#ff0000')
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(
        app.calls('PUT', `${TOKENS}/primitive.color.blue-500`),
      ).toHaveLength(1),
    )
    expect(
      app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)[0]?.body,
    ).toEqual({
      type: 'color',
      value: { colorSpace: 'srgb', components: [1, 0, 0] },
      description: 'The brand blue',
      expectedVersion: 3,
    })
    await waitFor(() =>
      expect(announcement()).toHaveTextContent(
        'Saved primitive.color.blue-500, revision 13',
      ),
    )
    expect(screen.getByText('13')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
    ).toHaveTextContent('#ff0000')
    expect(app.unexpected).toEqual([])
  })

  it('keeps unrounded components when the hex is untouched', async () => {
    const user = userEvent.setup()
    const app = await openEditor({
      extra: {
        [put]: {
          body: {
            token: row({
              path: 'primitive.color.blue-500',
              type: 'color',
              value: BLUE,
              version: 13,
            }),
            draftRevision: 13,
            warnings: [],
          },
        },
      },
    })
    const region = await selectToken(user, 'primitive.color.blue-500')
    const description = within(region).getByRole('textbox', {
      name: /^Description/,
    })
    await user.clear(description)
    await user.type(description, 'Renamed')
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(
        app.calls('PUT', `${TOKENS}/primitive.color.blue-500`),
      ).toHaveLength(1),
    )
    expect(
      app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)[0]?.body,
    ).toMatchObject({
      value: BLUE,
      description: 'Renamed',
    })
  })

  it('an invalid value is a field error and a focused summary, and nothing is sent', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, 'zzz')
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    const summary = await within(left()).findByRole('alert')
    expect(summary).toHaveTextContent('There is a problem')
    expect(summary).toHaveFocus()
    expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)).toHaveLength(
      0,
    )
  })

  it('Save does nothing until something changed', async () => {
    const user = userEvent.setup()
    await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    expect(within(region).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('Cancel puts the saved values back', async () => {
    const user = userEvent.setup()
    await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#000000')
    await user.click(within(region).getByRole('button', { name: 'Cancel' }))
    expect(hex).toHaveValue('#2563eb')
  })

  it('a version conflict keeps what was typed, shows the latest saved value, and needs a second explicit click to overwrite', async () => {
    const user = userEvent.setup()
    const conflict = apiError(409, 'VERSION_CONFLICT', 'x', {
      currentVersion: 9,
    })
    const app = await openEditor({ extra: { [put]: conflict } })
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#00ff00')

    // somebody else saved red meanwhile: the refetch after the 409 returns it
    app.setHandler(`GET ${TOKENS}`, {
      body: {
        draftRevision: 14,
        tokens: LIST.map((t) =>
          t.path === 'primitive.color.blue-500'
            ? {
                ...t,
                value: { colorSpace: 'srgb', components: [1, 0, 0] },
                version: 9,
              }
            : t,
        ),
      },
    })
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    const alert = await screen.findByText(/changed since you loaded it/i)
    const box = alert.closest('.dts-alert') as HTMLElement
    expect(within(box).getByText(/#ff0000/)).toBeVisible()
    expect(hex).toHaveValue('#00ff00')
    expect(app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)).toHaveLength(
      1,
    )

    app.setHandler(put, {
      body: {
        token: row({
          path: 'primitive.color.blue-500',
          type: 'color',
          value: { colorSpace: 'srgb', components: [0, 1, 0] },
          version: 15,
        }),
        draftRevision: 15,
        warnings: [],
      },
    })
    await user.click(
      within(box).getByRole('button', { name: 'Save over their version' }),
    )
    await waitFor(() =>
      expect(
        app.calls('PUT', `${TOKENS}/primitive.color.blue-500`),
      ).toHaveLength(2),
    )
    expect(
      app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)[1]?.body,
    ).toMatchObject({ expectedVersion: 9 })
  })

  it('a token deleted by someone else offers to create it again, without a version', async () => {
    const user = userEvent.setup()
    const gone = apiError(409, 'VERSION_CONFLICT', 'x', {
      currentVersion: null,
    })
    const app = await openEditor({ extra: { [put]: gone } })
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#00ff00')
    app.setHandler(`GET ${TOKENS}`, {
      body: {
        draftRevision: 14,
        tokens: LIST.filter((t) => t.path !== 'primitive.color.blue-500'),
      },
    })
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    const create = await screen.findByRole('button', {
      name: 'Create it again',
    })
    app.setHandler(put, {
      status: 201,
      body: {
        token: row({
          path: 'primitive.color.blue-500',
          type: 'color',
          value: BLUE,
          version: 15,
        }),
        draftRevision: 15,
        warnings: [],
      },
    })
    await user.click(create)
    await waitFor(() =>
      expect(
        app.calls('PUT', `${TOKENS}/primitive.color.blue-500`),
      ).toHaveLength(2),
    )
    expect(
      Object.keys(
        app.calls('PUT', `${TOKENS}/primitive.color.blue-500`)[1]
          ?.body as object,
      ),
    ).not.toContain('expectedVersion')
  })
})

describe('creating', () => {
  it('creates a token without a version, selects it, and moves focus to its heading', async () => {
    const user = userEvent.setup()
    const path = 'primitive.color.fresh'
    const app = await openEditor({
      extra: {
        [`PUT ${TOKENS}/${path}`]: {
          status: 201,
          body: {
            token: row({
              path,
              type: 'color',
              value: { colorSpace: 'srgb', components: [1, 1, 1] },
              version: 13,
            }),
            draftRevision: 13,
            warnings: [],
          },
        },
      },
    })
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const region = await screen.findByRole('region', { name: 'New token' })
    await user.type(
      within(region).getByRole('textbox', { name: /^Path/ }),
      path,
    )
    await user.selectOptions(
      within(region).getByRole('combobox', { name: /^Type/ }),
      'color',
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Color \(hex\)/ }),
      '#fff',
    )
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.calls('PUT', `${TOKENS}/${path}`)).toHaveLength(1),
    )
    expect(app.calls('PUT', `${TOKENS}/${path}`)[0]?.body).toEqual({
      type: 'color',
      value: { colorSpace: 'srgb', components: [1, 1, 1] },
    })
    const heading = await screen.findByRole('heading', { level: 2, name: path })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(app.location()).toBe(`${ROUTE}?token=${path}`)
  })

  it('creates an alias: no type needed, the value is the target', async () => {
    const user = userEvent.setup()
    const path = 'semantic.color.second'
    const app = await openEditor({
      extra: {
        [`PUT ${TOKENS}/${path}`]: {
          status: 201,
          body: {
            token: row({
              path,
              value: '{primitive.color.blue-500}',
              version: 13,
            }),
            draftRevision: 13,
            warnings: [],
          },
        },
      },
    })
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const region = await screen.findByRole('region', { name: 'New token' })
    await user.type(
      within(region).getByRole('textbox', { name: /^Path/ }),
      path,
    )
    await user.selectOptions(
      within(region).getByRole('combobox', { name: /^Kind/ }),
      'alias',
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Alias target/ }),
      'primitive.color.blue-500',
    )
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.calls('PUT', `${TOKENS}/${path}`)).toHaveLength(1),
    )
    expect(app.calls('PUT', `${TOKENS}/${path}`)[0]?.body).toEqual({
      value: '{primitive.color.blue-500}',
    })
  })

  it('a server path conflict is an error on the path field naming the other token', async () => {
    const user = userEvent.setup()
    const path = 'primitive.color.fresh'
    await openEditor({
      extra: {
        [`PUT ${TOKENS}/${path}`]: apiError(409, 'PATH_CONFLICT', 'x', {
          conflictsWith: 'primitive.color.fresh.deep',
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const region = await screen.findByRole('region', { name: 'New token' })
    const pathField = within(region).getByRole('textbox', { name: /^Path/ })
    await user.type(pathField, path)
    await user.selectOptions(
      within(region).getByRole('combobox', { name: /^Type/ }),
      'number',
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Value/ }),
      '1',
    )
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(pathField).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(
      within(region).getAllByText(/primitive\.color\.fresh\.deep/).length,
    ).toBeGreaterThan(0)
  })

  it('local checks warn about a missing alias target before anything is sent, wording it as "here", never "publishable"', async () => {
    const user = userEvent.setup()
    const path = 'semantic.color.second'
    await openEditor()
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const region = await screen.findByRole('region', { name: 'New token' })
    await user.type(
      within(region).getByRole('textbox', { name: /^Path/ }),
      path,
    )
    await user.selectOptions(
      within(region).getByRole('combobox', { name: /^Kind/ }),
      'alias',
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Alias target/ }),
      'primitive.color.missing',
    )
    expect(
      await within(region).findByText(/no token has this path/i),
    ).toBeVisible()
    expect(region.textContent).not.toMatch(/publishable/i)
    await user.clear(
      within(region).getByRole('textbox', { name: /^Alias target/ }),
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Alias target/ }),
      'primitive.color.blue-500',
    )
    expect(await within(region).findByText(/looks valid here/i)).toBeVisible()
  })
})

describe('discarding', () => {
  it('asks before another token replaces unsaved edits (our Dialog), and honors both answers', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#000000')

    await user.click(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard changes?',
    })
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    )
    await act(() => dialogs.flush())
    expect(app.location()).toBe(`${ROUTE}?token=primitive.color.blue-500`)
    expect(hex).toHaveValue('#000000')

    await user.click(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    )
    const again = await screen.findByRole('dialog', {
      name: 'Discard changes?',
    })
    await user.click(
      within(again).getByRole('button', { name: 'Discard changes' }),
    )
    await act(() => dialogs.flush())
    expect(
      await screen.findByRole('region', { name: 'primitive.space.4' }),
    ).toBeVisible()
    expect(app.location()).toBe(`${ROUTE}?token=primitive.space.4`)
  })

  it('does not ask when nothing was edited', async () => {
    const user = userEvent.setup()
    await openEditor()
    await selectToken(user, 'primitive.color.blue-500')
    await user.click(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      await screen.findByRole('region', { name: 'primitive.space.4' }),
    ).toBeVisible()
  })
})

describe('deleting', () => {
  it('confirms in our Dialog, sends the version in the query, and returns focus to the list heading', async () => {
    const user = userEvent.setup()
    const app = await openEditor({
      extra: {
        [`DELETE ${TOKENS}/primitive.space.4?expectedVersion=2`]: {
          body: { draftRevision: 13 },
        },
      },
    })
    await user.click(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    )
    const region = await screen.findByRole('region', {
      name: 'primitive.space.4',
    })
    await user.click(
      within(region).getByRole('button', { name: 'Delete token' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Delete token?' })
    expect(
      app.calls('DELETE', `${TOKENS}/primitive.space.4?expectedVersion=2`),
    ).toHaveLength(0)
    await user.click(
      within(dialog).getByRole('button', { name: 'Yes, delete' }),
    )
    await waitFor(() =>
      expect(
        app.calls('DELETE', `${TOKENS}/primitive.space.4?expectedVersion=2`),
      ).toHaveLength(1),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /primitive\.space\.4/ }),
      ).toBeNull(),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Tokens' }),
      ).toHaveFocus(),
    )
    expect(announcement()).toHaveTextContent(
      'Deleted primitive.space.4, revision 13',
    )
    expect(app.location()).toBe(ROUTE)
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    await user.click(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    )
    const region = await screen.findByRole('region', {
      name: 'primitive.space.4',
    })
    await user.click(
      within(region).getByRole('button', { name: 'Delete token' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Delete token?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep token' }))
    await act(() => dialogs.flush())
    expect(app.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: /primitive\.space\.4/ }),
    ).toBeVisible()
  })

  it('an unreadable row can be deleted but not edited', async () => {
    const user = userEvent.setup()
    const bad = row({
      path: 'primitive.color.bad',
      type: 'color',
      value: 'red',
      version: 9,
    })
    const app = await openEditor({
      tokens: [...LIST, bad],
      extra: {
        [`DELETE ${TOKENS}/primitive.color.bad?expectedVersion=9`]: {
          body: { draftRevision: 13 },
        },
      },
    })
    await user.click(
      screen.getByRole('button', { name: /primitive\.color\.bad/ }),
    )
    const region = await screen.findByRole('region', {
      name: 'primitive.color.bad',
    })
    expect(within(region).queryByRole('textbox')).toBeNull()
    expect(within(region).getByText(/cannot be read/i)).toBeVisible()
    await user.click(
      within(region).getByRole('button', { name: 'Delete token' }),
    )
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Yes, delete',
      }),
    )
    await waitFor(() =>
      expect(
        app.calls('DELETE', `${TOKENS}/primitive.color.bad?expectedVersion=9`),
      ).toHaveLength(1),
    )
  })
})

describe('the draft check', () => {
  const report = (over: object = {}) => ({
    body: {
      draftRevision: 12,
      publishable: false,
      issues: [
        {
          code: 'ALIAS_NOT_FOUND',
          severity: 'error',
          path: 'semantic.color.action',
          message: 'Alias target not found.',
        },
        {
          code: 'HEX_MISMATCH',
          severity: 'warning',
          path: 'primitive.color.blue-500',
          message: 'The hex does not match.',
        },
      ],
      ...over,
    },
  })

  it('shows errors and warnings as a list that links to the tokens, announces the result politely, and says which revision it checked', async () => {
    const user = userEvent.setup()
    const app = await openEditor({
      extra: { [`GET ${BASE}/validate`]: report() },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Draft check',
    })
    const section = heading.closest('section') as HTMLElement
    expect(within(section).getByText(/1 error, 1 warning/)).toBeVisible()
    expect(within(section).getByText('Checked at revision 12')).toBeVisible()
    await waitFor(() =>
      expect(announcement()).toHaveTextContent(
        'Draft check: 1 error, 1 warning',
      ),
    )
    const link = within(section).getByRole('link', {
      name: /semantic\.color\.action/,
    })
    expect(link).toHaveAttribute('href', `${ROUTE}?token=semantic.color.action`)
    await user.click(link)
    expect(
      await screen.findByRole('region', { name: 'semantic.color.action' }),
    ).toBeVisible()
    expect(app.location()).toBe(`${ROUTE}?token=semantic.color.action`)
  })

  it('says "publishable" only when the server says so', async () => {
    const user = userEvent.setup()
    await openEditor({
      extra: {
        [`GET ${BASE}/validate`]: report({ publishable: true, issues: [] }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Draft check',
    })
    expect(
      within(heading.closest('section') as HTMLElement).getByText(
        /draft check: publishable/i,
      ),
    ).toBeVisible()
  })

  it('does not make a link out of an issue path that is not a plain token path', async () => {
    const user = userEvent.setup()
    await openEditor({
      extra: {
        [`GET ${BASE}/validate`]: report({
          issues: [
            {
              code: 'RULE_FAILED',
              severity: 'error',
              path: '__proto__',
              message: 'Boom <b>x</b>',
            },
          ],
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Draft check',
    })
    const section = heading.closest('section') as HTMLElement
    expect(within(section).queryByRole('link')).toBeNull()
    expect(within(section).getByText(/Boom <b>x<\/b>/)).toBeVisible()
    expect(section.querySelector('b')).toBeNull()
  })

  it('a failed check says so and can be retried', async () => {
    const user = userEvent.setup()
    await openEditor({
      extra: { [`GET ${BASE}/validate`]: apiError(503, 'SERVICE_BUSY') },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    expect(await screen.findByText(/service is busy/i)).toBeVisible()
  })
})

describe('an empty draft', () => {
  it('offers the default theme and a blank token, and imports the starter with the current revision', async () => {
    const user = userEvent.setup()
    const importPath = `${TOKENS}/import`
    const app = await openEditor({
      tokens: [],
      revision: 0,
      extra: {
        [`POST ${importPath}`]: {
          body: { draftRevision: 1, count: 262, warnings: [] },
        },
      },
    })
    expect(screen.getByText(/this draft has no tokens yet/i)).toBeVisible()
    app.setHandler(`GET ${TOKENS}`, {
      body: { draftRevision: 1, tokens: LIST },
    })
    await user.click(
      screen.getByRole('button', { name: 'Start from the default theme' }),
    )
    await waitFor(() => expect(app.calls('POST', importPath)).toHaveLength(1))
    expect(app.calls('POST', importPath)[0]?.body).toEqual({
      tree: STARTER_TREE,
      expectedRevision: 0,
    })
    expect(await screen.findByText(/imported 262 tokens/i)).toBeVisible()
    expect(
      await screen.findByRole('button', { name: /primitive\.color\.blue-500/ }),
    ).toBeVisible()
  })

  it('a stale revision on import is explained, not retried', async () => {
    const user = userEvent.setup()
    await openEditor({
      tokens: [],
      revision: 0,
      extra: {
        [`POST ${TOKENS}/import`]: apiError(409, 'REVISION_CONFLICT', 'x', {
          currentRevision: 3,
        }),
      },
    })
    await user.click(
      screen.getByRole('button', { name: 'Start from the default theme' }),
    )
    expect(await screen.findByText(/draft changed/i)).toBeVisible()
  })
})

describe('the Viewer', () => {
  it('sees values as text and no way to change anything', async () => {
    const user = userEvent.setup()
    await openEditor({ role: 'VIEWER' })
    expect(
      screen.getByText(/can look at tokens but not change them/i),
    ).toBeVisible()
    for (const name of [
      'Create token',
      'Start from the default theme',
      'Save',
      'Delete token',
      'Cancel',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await user.click(
      screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
    )
    const region = await screen.findByRole('region', {
      name: 'primitive.color.blue-500',
    })
    expect(within(region).queryByRole('textbox')).toBeNull()
    expect(within(region).queryByRole('combobox')).toBeNull()
    expect(within(region).getByText('#2563eb')).toBeVisible()
    expect(within(region).getByText('The brand blue')).toBeVisible()
  })

  it('an empty draft shows no way to fill it', async () => {
    await openEditor({ role: 'VIEWER', tokens: [], revision: 0 })
    expect(screen.getByText(/this draft has no tokens yet/i)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Start from the default theme' }),
    ).toBeNull()
  })

  it('may still check the draft (a read)', async () => {
    await openEditor({ role: 'VIEWER' })
    expect(screen.getByRole('button', { name: 'Check draft' })).toBeVisible()
  })
})

describe('the live preview', () => {
  const styleText = () =>
    document.head.querySelector('style[data-dts-preview]')?.textContent ?? ''

  it('injects the working copy as one style scoped to the preview, and follows what is typed', async () => {
    const user = userEvent.setup()
    await openEditor()
    expect(
      screen.getByText('This preview shows @dts/ui components only.'),
    ).toBeVisible()
    await waitFor(() => expect(styleText()).toContain('[data-theme="preview"]'))
    expect(styleText()).toContain('--semantic-color-action: #2563eb')
    expect(styleText()).toContain('--component-button-bg: #2563eb')
    expect(
      document.head.querySelectorAll('style[data-dts-preview]'),
    ).toHaveLength(1)
    expect(document.querySelector('[data-theme="preview"]')).not.toBeNull()

    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#ff0000')
    await waitFor(() =>
      expect(styleText()).toContain('--semantic-color-action: #ff0000'),
    )
    expect(styleText()).toContain('--component-button-bg: #ff0000')
  })

  it('an invalid value in the form leaves the preview on the last good one', async () => {
    const user = userEvent.setup()
    await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, '#zz')
    await waitFor(() =>
      expect(styleText()).toContain('--semantic-color-action: #2563eb'),
    )
  })

  it('removes nothing from the page except its own style when it unmounts', async () => {
    const app = await openEditor()
    app.unmount()
    expect(
      document.head.querySelectorAll('style[data-dts-preview]'),
    ).toHaveLength(0)
  })
})

describe('accessibility (jsdom + axe, structure only)', () => {
  it('has one h1 and no violations: populated', async () => {
    const app = await openEditor()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: empty draft', async () => {
    const app = await openEditor({ tokens: [], revision: 0 })
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: editing', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    await selectToken(user, 'primitive.color.blue-500')
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: creating, with a local warning shown', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    const region = await screen.findByRole('region', { name: 'New token' })
    await user.type(
      within(region).getByRole('textbox', { name: /^Path/ }),
      'semantic.color.second',
    )
    await user.selectOptions(
      within(region).getByRole('combobox', { name: /^Kind/ }),
      'alias',
    )
    await user.type(
      within(region).getByRole('textbox', { name: /^Alias target/ }),
      'primitive.nope',
    )
    await within(region).findByText(/no token has this path/i)
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: an error summary', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    const region = await selectToken(user, 'primitive.color.blue-500')
    const hex = within(region).getByRole('textbox', { name: /^Color \(hex\)/ })
    await user.clear(hex)
    await user.type(hex, 'zzz')
    await user.click(within(region).getByRole('button', { name: 'Save' }))
    await within(left()).findByRole('alert')
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: the Viewer', async () => {
    const user = userEvent.setup()
    const app = await openEditor({ role: 'VIEWER' })
    await user.click(
      screen.getByRole('button', { name: /primitive\.color\.blue-500/ }),
    )
    await screen.findByRole('region', { name: 'primitive.color.blue-500' })
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: the delete dialog open', async () => {
    const user = userEvent.setup()
    const app = await openEditor()
    const region = await selectToken(user, 'primitive.space.4')
    await user.click(
      within(region).getByRole('button', { name: 'Delete token' }),
    )
    await screen.findByRole('dialog', { name: 'Delete token?' })
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('has no violations: the draft check result', async () => {
    const user = userEvent.setup()
    const app = await openEditor({
      extra: {
        [`GET ${BASE}/validate`]: {
          body: {
            draftRevision: 12,
            publishable: false,
            issues: [
              {
                code: 'ALIAS_NOT_FOUND',
                severity: 'error',
                path: 'semantic.color.action',
                message: 'Alias target not found.',
              },
            ],
          },
        },
      },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    await screen.findByRole('heading', { level: 2, name: 'Draft check' })
    expect(await axe(app.container)).toHaveNoViolations()
  })
})

describe('foreign and missing brands keep the 4a behavior', () => {
  it('a brand the caller cannot see is the generic not-found page', async () => {
    renderApp({
      route: ROUTE,
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [org()] } },
        [`GET ${BASE}`]: apiError(404, 'NOT_FOUND'),
      },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Brand not found' }),
    ).toBeVisible()
  })
})
