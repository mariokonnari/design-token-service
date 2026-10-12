import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'
import {
  SIGNED_IN,
  UNAUTHENTICATED,
  apiError,
  brand,
  org,
  renderApp,
  user,
  type Handler,
} from '../support/renderApp'

// Structure and behavior of the pages for assistive technology. jsdom has no layout
// engine and loads none of our CSS, so axe here CANNOT judge color contrast, focus
// rings or target size: the real-browser suite (e2e/) does, on the built bundle.

const acme = org()
const summit = brand()
const brandsPath = `/api/orgs/${acme.id}/brands`

const PAGES: {
  name: string
  route: string
  handlers: Record<string, Handler>
  h1: string
}[] = [
  {
    name: 'login',
    route: '/login',
    handlers: { 'GET /api/me': UNAUTHENTICATED },
    h1: 'Sign in',
  },
  {
    name: 'signup',
    route: '/signup',
    handlers: { 'GET /api/me': UNAUTHENTICATED },
    h1: 'Create an account',
  },
  {
    name: 'organization list',
    route: '/',
    handlers: {
      ...SIGNED_IN,
      'GET /api/orgs': { body: { organizations: [acme] } },
    },
    h1: 'Organizations',
  },
  {
    name: 'brand list',
    route: `/orgs/${acme.id}`,
    handlers: {
      ...SIGNED_IN,
      'GET /api/orgs': { body: { organizations: [acme] } },
      [`GET ${brandsPath}`]: { body: { brands: [summit] } },
    },
    h1: 'Acme',
  },
  {
    name: 'brand page',
    route: `/orgs/${acme.id}/brands/${summit.id}`,
    handlers: {
      ...SIGNED_IN,
      'GET /api/orgs': { body: { organizations: [acme] } },
      [`GET ${brandsPath}/${summit.id}`]: { body: { brand: summit } },
    },
    h1: 'Summit',
  },
  {
    name: 'not found',
    route: '/nowhere',
    handlers: { 'GET /api/me': UNAUTHENTICATED },
    h1: 'Page not found',
  },
]

describe.each(PAGES)('page: $name', ({ route, handlers, h1 }) => {
  it('has no axe violations, exactly one h1 and a matching document title', async () => {
    const app = renderApp({ route, handlers })
    await screen.findByRole('heading', { level: 1, name: h1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe(`${h1} – Design Token Service`)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(await axe(app.container)).toHaveNoViolations()
    expect(app.unexpected).toEqual([])
  })
})

describe('error states have no axe violations either', () => {
  it('a failed sign-in (alert + both fields)', async () => {
    const app = renderApp({
      route: '/login',
      handlers: {
        'GET /api/me': UNAUTHENTICATED,
        'POST /api/auth/login': apiError(401, 'INVALID_CREDENTIALS'),
      },
    })
    const typist = userEvent.setup()
    await typist.click(await screen.findByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')
    expect(await axe(app.container)).toHaveNoViolations()
    await typist.type(screen.getByLabelText(/email/i), 'a@b.co')
    await typist.type(screen.getByLabelText(/password/i), 'x')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /invalid email or password/i,
      )
    })
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('a create form with errors on both fields', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [] } },
      },
    })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    // the form appears once the list has loaded
    await typist.click(
      await screen.findByRole('button', { name: 'Create organization' }),
    )
    expect(screen.getByRole('alert')).toBeVisible()
    expect(await axe(app.container)).toHaveNoViolations()
  })

  it('a list that failed to load', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': apiError(500, 'INTERNAL_ERROR'),
      },
    })
    await screen.findByRole('alert')
    expect(await axe(app.container)).toHaveNoViolations()
  })
})

describe('keyboard and focus', () => {
  it('the skip link is the first tab stop and its target exists', async () => {
    const app = renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    await userEvent.setup().tab()
    const skip = screen.getByRole('link', { name: /skip to main content/i })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')
    expect(app.container.querySelector('main#main')).not.toBeNull()
  })

  it('does not steal focus on the first load', async () => {
    renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(document.body).toHaveFocus()
  })

  it('moves focus to the new page heading on in-app navigation and announces the page', async () => {
    renderApp({
      route: '/',
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [acme] } },
        [`GET ${brandsPath}`]: { body: { brands: [summit] } },
        [`GET ${brandsPath}/${summit.id}`]: { body: { brand: summit } },
      },
    })
    const typist = userEvent.setup()
    await typist.click(await screen.findByRole('link', { name: 'Acme' }))
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Acme',
    })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    expect(document.title).toBe('Acme – Design Token Service')
    // the live region is mounted from the start and its text changes
    const region = screen.getByRole('status', {
      name: /page changes|navigation/i,
    })
    expect(region).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => {
      expect(region).toHaveTextContent('Acme')
    })

    await typist.click(await screen.findByRole('link', { name: 'Summit' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      'Summit',
    )
  })

  it('every control is reachable by keyboard: sign in with Tab and Enter only', async () => {
    renderApp({
      route: '/login',
      handlers: {
        'GET /api/me': UNAUTHENTICATED,
        'POST /api/auth/login': { body: { user } },
        'GET /api/orgs': { body: { organizations: [] } },
      },
    })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    await typist.tab() // skip link
    await typist.tab() // email
    expect(screen.getByLabelText(/email/i)).toHaveFocus()
    await typist.keyboard('person@example.com')
    await typist.tab()
    expect(screen.getByLabelText(/password/i)).toHaveFocus()
    await typist.keyboard('secret{Enter}')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organizations' }),
    ).toBeVisible()
  })
})
