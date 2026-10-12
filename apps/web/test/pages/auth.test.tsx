import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  SIGNED_IN,
  UNAUTHENTICATED,
  apiError,
  deferred,
  org,
  renderApp,
  user,
} from '../support/renderApp'

const GUEST = { 'GET /api/me': UNAUTHENTICATED }
const ORGS_PAGE = { 'GET /api/orgs': { body: { organizations: [org()] } } }

async function fillLogin(email = 'person@example.com', password = 'secret') {
  const typist = userEvent.setup()
  await typist.type(await screen.findByLabelText(/email/i), email)
  await typist.type(screen.getByLabelText(/password/i), password)
  return typist
}

describe('login page', () => {
  it('has one h1, labelled fields and a link to sign up', async () => {
    renderApp({ route: '/login', handlers: GUEST })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText(/email/i)).toHaveAttribute(
      'autocomplete',
      'username',
    )
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
    expect(
      screen.getByRole('link', { name: /create an account/i }),
    ).toHaveAttribute('href', '/signup')
  })

  it('an empty submit makes NO request, marks both fields and moves focus to the error summary', async () => {
    const app = renderApp({ route: '/login', handlers: GUEST })
    const typist = userEvent.setup()
    await typist.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(app.calls('POST', '/api/auth/login')).toHaveLength(0)
    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    const links = within(summary).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Enter your email address.',
      'Enter your password.',
    ])
    expect(screen.getByLabelText(/email/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )

    // a link in the summary focuses its field without navigating
    const before = app.location()
    await typist.click(links[0]!)
    expect(screen.getByLabelText(/email/i)).toHaveFocus()
    expect(app.location()).toBe(before)
  })

  it('signs in: sends exactly the credentials and shows the organizations page', async () => {
    const app = renderApp({
      route: '/login',
      handlers: {
        ...GUEST,
        'POST /api/auth/login': { body: { user } },
        ...ORGS_PAGE,
      },
    })
    const typist = await fillLogin()
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organizations' }),
    ).toBeVisible()
    expect(app.calls('POST', '/api/auth/login')[0]?.body).toEqual({
      email: 'person@example.com',
      password: 'secret',
    })
    expect(app.location()).toBe('/')
    expect(app.unexpected).toEqual([])
  })

  it('returns to the page in ?next', async () => {
    const orgId = org().id
    const app = renderApp({
      route: `/login?next=${encodeURIComponent(`/orgs/${orgId}`)}`,
      handlers: {
        ...GUEST,
        'POST /api/auth/login': { body: { user } },
        ...ORGS_PAGE,
        [`GET /api/orgs/${orgId}/brands`]: { body: { brands: [] } },
      },
    })
    const typist = await fillLogin()
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme' }),
    ).toBeVisible()
    expect(app.location()).toBe(`/orgs/${orgId}`)
  })

  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com/x',
    'javascript:alert(1)',
    '/%2F%2Fevil.com',
  ])('ignores the hostile next %j and lands on the home page', async (next) => {
    const app = renderApp({
      route: `/login?next=${encodeURIComponent(next)}`,
      handlers: {
        ...GUEST,
        'POST /api/auth/login': { body: { user } },
        ...ORGS_PAGE,
      },
    })
    const typist = await fillLogin()
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(app.location()).toBe('/')
  })

  it('passes next on to the sign-up page', async () => {
    renderApp({ route: '/login?next=%2Forgs%2Fabc', handlers: GUEST })
    const link = await screen.findByRole('link', { name: /create an account/i })
    expect(link).toHaveAttribute('href', '/signup?next=%2Forgs%2Fabc')
  })

  it('a wrong password is ONE generic message; the fields are not blamed and the password is cleared', async () => {
    const app = renderApp({
      route: '/login',
      handlers: {
        ...GUEST,
        'POST /api/auth/login': apiError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
        ),
      },
    })
    const typist = await fillLogin('person@example.com', 'wrong-password')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid email or password.')
    expect(alert).toHaveFocus()
    expect(screen.getByLabelText(/email/i)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText(/password/i)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText(/email/i)).toHaveValue('person@example.com')
    expect(screen.getByLabelText(/password/i)).toHaveValue('')
    expect(app.location()).toBe('/login')
  })

  it('an unknown email gives the very same message', async () => {
    renderApp({
      route: '/login',
      handlers: {
        ...GUEST,
        'POST /api/auth/login': apiError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
        ),
      },
    })
    const typist = await fillLogin('nobody@example.com', 'whatever-it-is')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password.',
    )
  })

  it('429 says how long to wait; 503 asks to try again; a dead network says so', async () => {
    const cases = [
      [
        { ...apiError(429, 'RATE_LIMITED'), headers: { 'retry-after': '300' } },
        /too many attempts.*5 minutes/i,
      ],
      [apiError(503, 'SERVICE_BUSY'), /busy.*try again/i],
      [{ networkError: true }, /cannot reach the server/i],
    ] as const
    for (const [reply, text] of cases) {
      const view = renderApp({
        route: '/login',
        handlers: { ...GUEST, 'POST /api/auth/login': reply },
      })
      const typist = await fillLogin()
      await typist.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      view.unmount()
    }
  })

  it('an unknown error is generic, quotes the request id and never shows server text as markup', async () => {
    const hostile = '<img src=x onerror="window.pwned=1">'
    const app = renderApp({
      route: '/login',
      handlers: {
        ...GUEST,
        'POST /api/auth/login': apiError(500, 'INTERNAL_ERROR', hostile),
      },
    })
    const typist = await fillLogin()
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
    expect(alert).toHaveTextContent('req-00000001')
    expect(alert).not.toHaveTextContent('onerror')
    expect(app.container.querySelector('img')).toBeNull()
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
  })

  it('shows a pending state and ignores a second submit while the first is in flight', async () => {
    const gate = deferred()
    const app = renderApp({
      route: '/login',
      handlers: {
        ...GUEST,
        'POST /api/auth/login': { body: { user }, hold: gate.promise },
        ...ORGS_PAGE,
      },
    })
    const typist = await fillLogin()
    await typist.keyboard('{Enter}')
    const pending = await screen.findByRole('button', { name: 'Signing in…' })
    expect(pending).toBeDisabled()
    await typist.keyboard('{Enter}')
    await typist.click(pending)
    expect(app.calls('POST', '/api/auth/login')).toHaveLength(1)
    gate.release()
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(app.calls('POST', '/api/auth/login')).toHaveLength(1)
  })

  it('a visitor who is already signed in is sent home', async () => {
    const app = renderApp({
      route: '/login',
      handlers: { ...SIGNED_IN, ...ORGS_PAGE },
    })
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(app.location()).toBe('/')
  })
})

describe('signup page', () => {
  async function fillSignup(email: string, password: string) {
    const typist = userEvent.setup()
    await typist.type(await screen.findByLabelText(/email/i), email)
    await typist.type(screen.getByLabelText(/password/i), password)
    return typist
  }

  it('has one h1, a password hint and the right autocomplete values', async () => {
    renderApp({ route: '/signup', handlers: GUEST })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Create an account',
      }),
    ).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
    expect(screen.getByText(/at least 12 characters/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('checks the email and the password length before sending anything', async () => {
    const app = renderApp({ route: '/signup', handlers: GUEST })
    const typist = await fillSignup('not-an-email', 'short')
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    expect(app.calls('POST', '/api/auth/signup')).toHaveLength(0)
    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    expect(within(summary).getAllByRole('link')).toHaveLength(2)
    expect(screen.getByLabelText(/email/i)).toHaveAccessibleDescription(
      /valid email address/i,
    )
    expect(screen.getByLabelText(/password/i)).toHaveAccessibleDescription(
      /at least 12 characters/i,
    )
  })

  it('creates the account and lands on the organizations page', async () => {
    const app = renderApp({
      route: '/signup',
      handlers: {
        ...GUEST,
        'POST /api/auth/signup': { status: 201, body: { user } },
        'GET /api/orgs': { body: { organizations: [] } },
      },
    })
    const typist = await fillSignup(
      'person@example.com',
      'correct horse battery',
    )
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    expect(app.calls('POST', '/api/auth/signup')[0]?.body).toEqual({
      email: 'person@example.com',
      password: 'correct horse battery',
    })
    expect(app.location()).toBe('/')
  })

  it('a taken email is an error on the email field and the summary takes focus', async () => {
    renderApp({
      route: '/signup',
      handlers: {
        ...GUEST,
        'POST /api/auth/signup': apiError(
          409,
          'EMAIL_TAKEN',
          'Email already registered.',
        ),
      },
    })
    const typist = await fillSignup(
      'person@example.com',
      'correct horse battery',
    )
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    const email = screen.getByLabelText(/email/i)
    await waitFor(() => {
      expect(email).toHaveAttribute('aria-invalid', 'true')
    })
    expect(email).toHaveAccessibleDescription(/already exists/i)
    expect(screen.getByRole('alert')).toHaveFocus()
  })

  it('shows the API password-policy sentence for a 400 without a field', async () => {
    renderApp({
      route: '/signup',
      handlers: {
        ...GUEST,
        'POST /api/auth/signup': apiError(
          400,
          'VALIDATION_ERROR',
          'The password is too common.',
        ),
      },
    })
    const typist = await fillSignup(
      'person@example.com',
      'correct horse battery',
    )
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password is too common.',
    )
  })

  it('shows the text of a 400 as text, even if it contains markup', async () => {
    const hostile = '<img src=x onerror="window.pwned=1"> too common'
    const app = renderApp({
      route: '/signup',
      handlers: {
        ...GUEST,
        'POST /api/auth/signup': apiError(400, 'VALIDATION_ERROR', hostile),
      },
    })
    const typist = await fillSignup(
      'person@example.com',
      'correct horse battery',
    )
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(hostile)
    expect(app.container.querySelector('img')).toBeNull()
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
  })

  it('says so when sign-ups are disabled', async () => {
    renderApp({
      route: '/signup',
      handlers: {
        ...GUEST,
        'POST /api/auth/signup': apiError(403, 'SIGNUP_DISABLED'),
      },
    })
    const typist = await fillSignup(
      'person@example.com',
      'correct horse battery',
    )
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/disabled/i)
  })
})
