import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  SIGNED_IN,
  UNAUTHENTICATED,
  apiError,
  brand,
  org,
  renderApp,
} from '../support/renderApp'

const acme = org()
const summit = brand()
const brandsPath = `/api/orgs/${acme.id}/brands`

function handlers(
  role: 'OWNER' | 'EDITOR' | 'VIEWER' = 'OWNER',
  brands: ReturnType<typeof brand>[] = [summit],
) {
  return {
    ...SIGNED_IN,
    'GET /api/orgs': { body: { organizations: [org({ role })] } },
    [`GET ${brandsPath}`]: { body: { brands } },
  }
}

describe('brand list', () => {
  it('shows the organization as the page heading, its brands as links, and a way back', async () => {
    renderApp({ route: `/orgs/${acme.id}`, handlers: handlers() })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme' }),
    ).toBeVisible()
    const link = await screen.findByRole('link', { name: 'Summit' })
    expect(link).toHaveAttribute('href', `/orgs/${acme.id}/brands/${summit.id}`)
    const item = link.closest('li')!
    expect(within(item).getByText('summit')).toBeVisible()
    expect(within(item).getByText('Private')).toBeVisible()
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole(
        'link',
        {
          name: 'Organizations',
        },
      ),
    ).toHaveAttribute('href', '/')
  })

  it('says so when the organization has no brands', async () => {
    renderApp({ route: `/orgs/${acme.id}`, handlers: handlers('OWNER', []) })
    expect(await screen.findByText(/no brands yet/i)).toBeVisible()
  })

  it.each(['OWNER', 'EDITOR'] as const)(
    'a %s can create a brand: the form is there and sends exactly name and slug',
    async (role) => {
      const created = brand({
        id: '55555555-5555-4555-8555-555555555555',
        slug: 'fresh',
        name: 'Fresh',
      })
      const app = renderApp({
        route: `/orgs/${acme.id}`,
        handlers: {
          ...handlers(role, []),
          [`POST ${brandsPath}`]: { status: 201, body: { brand: created } },
        },
      })
      await screen.findByRole('heading', { level: 1, name: 'Acme' })
      const typist = userEvent.setup()
      await typist.type(await screen.findByLabelText(/^name/i), 'Fresh')
      expect(screen.getByLabelText(/^slug/i)).toHaveValue('fresh')
      await typist.click(screen.getByRole('button', { name: 'Create brand' }))

      expect(await screen.findByRole('link', { name: 'Fresh' })).toBeVisible()
      expect(app.calls('POST', brandsPath)[0]?.body).toEqual({
        name: 'Fresh',
        slug: 'fresh',
      })
      expect(screen.getByText(/created brand.*fresh/i)).toBeVisible()
    },
  )

  it('a viewer sees the brands but no form, and is told why', async () => {
    renderApp({ route: `/orgs/${acme.id}`, handlers: handlers('VIEWER') })
    await screen.findByRole('link', { name: 'Summit' })
    expect(screen.queryByRole('button', { name: 'Create brand' })).toBeNull()
    expect(screen.queryByLabelText(/^slug/i)).toBeNull()
    expect(screen.getByText(/viewer.*cannot create brands/i)).toBeVisible()
  })

  it('a taken brand slug (the generic CONFLICT code) marks the slug field', async () => {
    renderApp({
      route: `/orgs/${acme.id}`,
      handlers: {
        ...handlers(),
        [`POST ${brandsPath}`]: apiError(
          409,
          'CONFLICT',
          'A brand with this slug already exists.',
        ),
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Acme' })
    const typist = userEvent.setup()
    await typist.type(await screen.findByLabelText(/^name/i), 'Summit')
    await typist.click(screen.getByRole('button', { name: 'Create brand' }))
    await waitFor(() => {
      expect(screen.getByLabelText(/^slug/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      )
    })
    expect(screen.getByLabelText(/^slug/i)).toHaveAccessibleDescription(
      /already in use/i,
    )
    expect(screen.getByRole('alert')).toHaveFocus()
  })

  it('a 403 from the API (the role changed) is a clear message', async () => {
    renderApp({
      route: `/orgs/${acme.id}`,
      handlers: {
        ...handlers(),
        [`POST ${brandsPath}`]: apiError(403, 'FORBIDDEN'),
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Acme' })
    const typist = userEvent.setup()
    await typist.type(await screen.findByLabelText(/^name/i), 'Summit')
    await typist.click(screen.getByRole('button', { name: 'Create brand' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /role.*does not allow/i,
    )
  })

  it('an organization that is not in my list is "not found" (same page for a foreign or invented id)', async () => {
    const app = renderApp({
      route: '/orgs/99999999-9999-4999-8999-999999999999',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
      },
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Organization not found',
      }),
    ).toBeVisible()
    // it never even asked for that organization's brands
    expect(app.requests.filter((r) => r.path.includes('/brands'))).toEqual([])
    expect(
      screen.getByRole('link', { name: /organizations/i }),
    ).toHaveAttribute('href', '/')
  })

  it('a 404 for the brand list is the same not-found page', async () => {
    renderApp({
      route: `/orgs/${acme.id}`,
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        [`GET ${brandsPath}`]: apiError(404, 'NOT_FOUND', 'Not found.'),
      },
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Organization not found',
      }),
    ).toBeVisible()
  })

  it('brand names render as text, never as markup', async () => {
    const hostile = brand({ name: '<script>window.pwned=1</script>Evil' })
    const app = renderApp({
      route: `/orgs/${acme.id}`,
      handlers: handlers('OWNER', [hostile]),
    })
    expect(await screen.findByRole('link', { name: /Evil/ })).toHaveTextContent(
      '<script>window.pwned=1</script>Evil',
    )
    expect(app.container.querySelector('script')).toBeNull()
  })
})

describe('brand page (the editor lives in test/pages/editor.test.tsx)', () => {
  const brandPath = `/api/orgs/${acme.id}/brands/${summit.id}`
  const route = `/orgs/${acme.id}/brands/${summit.id}`

  it('shows the brand, the editor and a way back', async () => {
    renderApp({
      route,
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        [`GET ${brandPath}`]: { body: { brand: summit } },
        [`GET ${brandPath}/tokens`]: { body: { draftRevision: 0, tokens: [] } },
      },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Summit' }),
    ).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      await screen.findByRole('button', {
        name: 'Start from the default theme',
      }),
    ).toBeVisible()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/orgs/${acme.id}`,
    )
  })

  it('a brand that is missing, foreign or malformed is the same not-found page', async () => {
    renderApp({
      route,
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        [`GET ${brandPath}`]: apiError(404, 'NOT_FOUND', 'Not found.'),
      },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Brand not found' }),
    ).toBeVisible()
  })
})

describe('the not-found page', () => {
  it('an unknown URL shows a 404 page with a way home, without needing a session', async () => {
    const app = renderApp({
      route: '/nowhere/at/all',
      handlers: { 'GET /api/me': UNAUTHENTICATED },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /home|organizations/i }),
    ).toHaveAttribute('href', '/')
    expect(app.location()).toBe('/nowhere/at/all')
  })
})
