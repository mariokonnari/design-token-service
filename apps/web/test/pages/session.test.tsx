import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ME_KEY } from '../../src/auth/me'
import {
  SIGNED_IN,
  UNAUTHENTICATED,
  apiError,
  org,
  renderApp,
  user,
} from '../support/renderApp'

const acme = org()
const other = org({
  id: '66666666-6666-4666-8666-666666666666',
  slug: 'other-co',
  name: 'Other Co',
})

describe('RequireAuth', () => {
  it('sends a visitor without a session to /login, remembering the page they wanted', async () => {
    const app = renderApp({
      route: `/orgs/${acme.id}?tab=x`,
      handlers: { 'GET /api/me': UNAUTHENTICATED },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeVisible()
    expect(app.location()).toBe(
      `/login?next=${encodeURIComponent(`/orgs/${acme.id}?tab=x`)}`,
    )
    // nothing from the protected page was requested
    expect(app.requests.map((r) => r.path)).toEqual(['/api/me'])
  })

  it('the home page needs no next', async () => {
    const app = renderApp({
      route: '/',
      handlers: { 'GET /api/me': UNAUTHENTICATED },
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(app.location()).toBe('/login')
  })

  it('lets a signed-in visitor through, asking who they are once', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(app.calls('GET', '/api/me')).toHaveLength(1)
    expect(app.location()).toBe('/')
  })

  it('a network failure while checking the session is an error screen, NOT a redirect to /login', async () => {
    const app = renderApp({
      route: `/orgs/${acme.id}`,
      handlers: { 'GET /api/me': { networkError: true } },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /cannot reach the server/i,
    )
    expect(app.location()).toBe(`/orgs/${acme.id}`)
    // and it recovers
    app.setHandler('GET /api/me', SIGNED_IN['GET /api/me']!)
    app.setHandler('GET /api/orgs', { body: { organizations: [acme] } })
    app.setHandler(`GET /api/orgs/${acme.id}/brands`, { body: { brands: [] } })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /try again/i }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme' }),
    ).toBeVisible()
  })
})

describe('the session ends while the app is open (the single auth-expired signal)', () => {
  it('a 401 from any call sends the person to /login?next=<where they were> and empties the cache', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        [`GET /api/orgs/${acme.id}/brands`]: UNAUTHENTICATED,
      },
    })
    const typist = userEvent.setup()
    await typist.click(await screen.findByRole('link', { name: 'Acme' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeVisible()
    expect(app.location()).toBe(
      `/login?next=${encodeURIComponent(`/orgs/${acme.id}`)}`,
    )
    // no data of the previous session is left in memory
    const cached = app.queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[0] !== ME_KEY[0])
    expect(cached.map((q) => q.queryKey)).toEqual([])
    expect(app.queryClient.getQueryData(ME_KEY)).toBeNull()
    // (the screen-reader announcement of the old page is replaced a tick later)
    await waitFor(() => {
      expect(screen.queryByText('Acme')).toBeNull()
    })
  })

  it('signing in again as someone else shows THEIR data, not a stale copy', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        'POST /api/auth/logout': { status: 204 },
      },
    })
    const typist = userEvent.setup()
    await screen.findByRole('link', { name: 'Acme' })

    await typist.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(app.calls('POST', '/api/auth/logout')).toHaveLength(1)
    expect(app.location()).toBe('/login')
    expect(app.queryClient.getQueryData(ME_KEY)).toBeNull()
    expect(
      app.queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[0]),
    ).toEqual([ME_KEY[0]])

    app.setHandler('GET /api/me', UNAUTHENTICATED)
    app.setHandler('POST /api/auth/login', {
      body: { user: { ...user, email: 'second@example.com' } },
    })
    app.setHandler('GET /api/orgs', { body: { organizations: [other] } })
    await typist.type(screen.getByLabelText(/email/i), 'second@example.com')
    await typist.type(screen.getByLabelText(/password/i), 'secret')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('link', { name: 'Other Co' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Acme' })).toBeNull()
    expect(app.calls('GET', '/api/orgs')).toHaveLength(2)
  })
})

describe('logout', () => {
  it('shows who is signed in and a Log out button on every protected page', async () => {
    renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [] } },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(screen.getByText(user.email)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled()
  })

  it('a failed logout keeps the person signed in and says so (the cookie is still valid)', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        'POST /api/auth/logout': { networkError: true },
      },
    })
    await screen.findByRole('link', { name: 'Acme' })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not log you out/i,
    )
    expect(app.location()).toBe('/')
    expect(screen.getByRole('link', { name: 'Acme' })).toBeVisible()
  })

  it('a 400/500 on logout is also reported, not swallowed', async () => {
    renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        'POST /api/auth/logout': apiError(500, 'INTERNAL_ERROR'),
      },
    })
    await screen.findByRole('link', { name: 'Acme' })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeVisible()
    })
  })
})

describe('nothing is kept in the browser', () => {
  it('login, browsing and logout leave localStorage and sessionStorage empty', async () => {
    const app = renderApp({
      route: '/login',
      handlers: {
        'GET /api/me': UNAUTHENTICATED,
        'POST /api/auth/login': { body: { user } },
        'GET /api/orgs': { body: { organizations: [acme] } },
        'POST /api/auth/logout': { status: 204 },
      },
    })
    const typist = userEvent.setup()
    await typist.type(
      await screen.findByLabelText(/email/i),
      'person@example.com',
    )
    await typist.type(screen.getByLabelText(/password/i), 'secret')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('link', { name: 'Acme' })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    await typist.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(app.unexpected).toEqual([])
  })
})
