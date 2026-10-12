import { expect, request as playwrightRequest, test } from '@playwright/test'
import {
  ORIGIN_HEADER,
  createOrgViaApi,
  logInViaUi,
  sessionCookie,
  newUser,
  signUpViaApi,
  signUpViaUi,
} from './support/app'
import { WEB_ORIGIN } from './support/ports'

test('the session cookie is HttpOnly, SameSite=Lax and not Secure in development', async ({
  page,
}) => {
  await signUpViaUi(page)
  const cookie = await sessionCookie(page)
  expect(cookie, 'the session cookie must exist').toBeDefined()
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')
  expect(cookie?.secure).toBe(false)
  expect(cookie?.path).toBe('/')
  // no Domain attribute: a host-only cookie (Playwright reports the host without a leading dot)
  expect(cookie?.domain.startsWith('.')).toBe(false)
  // page scripts cannot read it
  expect(await page.evaluate(() => document.cookie)).toBe('')
})

test('nothing is kept in localStorage or sessionStorage, before or after signing in', async ({
  page,
}) => {
  await page.goto('/login')
  const storage = () =>
    page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }))
  expect(await storage()).toEqual({ local: 0, session: 0 })
  await signUpViaUi(page)
  expect(await storage()).toEqual({ local: 0, session: 0 })
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible()
  expect(await storage()).toEqual({ local: 0, session: 0 })
})

test('the browser reaches the API only through its own origin (the /api proxy), with no CORS headers', async ({
  page,
}) => {
  const response = await page.request.get('/api/me')
  expect(response.status()).toBe(401)
  expect(
    ((await response.json()) as { error: { code: string } }).error.code,
  ).toBe('UNAUTHENTICATED')
  expect(response.headers()['access-control-allow-origin']).toBeUndefined()
  expect(response.headers()['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/)

  // and every request the app itself makes goes to the page's own origin
  const foreign: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== WEB_ORIGIN) foreign.push(request.url())
  })
  await signUpViaUi(page)
  expect(foreign).toEqual([])
})

test('a session revoked on the server ends the app session on its next request, and clears cached data', async ({
  page,
  playwright,
}) => {
  const user = await signUpViaApi(page)
  const org = await createOrgViaApi(page, 'Revoked Co')
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Revoked Co' })).toBeVisible()

  // Revoke every session of this user from OUTSIDE the browser, with the SAME cookie.
  // A separate request context keeps the browser's own cookie jar untouched, so the
  // browser still holds a cookie that is cryptographically valid but now revoked
  // (the server compares the session version on every request, ADR 0013).
  const cookie = await sessionCookie(page)
  expect(cookie).toBeDefined()
  const outside = await playwright.request.newContext({
    baseURL: WEB_ORIGIN,
    extraHTTPHeaders: {
      ...ORIGIN_HEADER,
      Cookie: `dts_session=${cookie?.value ?? ''}`,
    },
  })
  const revoke = await outside.post('/api/auth/logout-all')
  expect(revoke.status()).toBe(204)
  await outside.dispose()
  // the browser has not noticed yet: its jar still has the (now useless) cookie
  expect((await sessionCookie(page))?.value).toBe(cookie?.value)

  // The next thing the app asks the server is refused: it lands on /login?next=…
  await page.getByRole('link', { name: 'Revoked Co' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await expect(page).toHaveURL(
    `/login?next=${encodeURIComponent(`/orgs/${org.id}`)}`,
  )

  // Nothing of the old session is left on screen, and going back does not bring it back
  await expect(page.getByText('Revoked Co')).toHaveCount(0)
  await page.goBack()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await expect(page.getByText('Revoked Co')).toHaveCount(0)

  // Signing in again as the same user returns to the page that was wanted, with data
  // fetched afresh (not a stale copy)
  await page.goto(`/login?next=${encodeURIComponent(`/orgs/${org.id}`)}`)
  const orgRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/orgs')
      orgRequests.push(request.url())
  })
  await logInViaUi(page, user)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Revoked Co' }),
  ).toBeVisible()
  expect(orgRequests.length).toBeGreaterThanOrEqual(1)
})

test('logging out clears what was cached: the next person in this tab sees only their own data', async ({
  page,
}) => {
  await signUpViaApi(page)
  await createOrgViaApi(page, 'First Persons Co')
  await page.goto('/')
  await expect(
    page.getByRole('link', { name: 'First Persons Co' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()

  // a second person signs up in the same tab, without a reload
  await page.getByRole('link', { name: /create an account/i }).click()
  const second = newUser()
  await page.getByLabel(/^email/i).fill(second.email)
  await page.getByLabel(/^password/i).fill(second.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible()
  await expect(page.getByText('First Persons Co')).toHaveCount(0)
  await expect(
    page.getByText(/not a member of any organization yet/i),
  ).toBeVisible()
})

test('a request made without an Origin from an allowed origin is refused by the API (the page never needs to care)', async () => {
  // Pins the premise of the whole set-up: the proxy forwards the browser Origin, and
  // the API refuses state changes without one (ADR 0013).
  const bare = await playwrightRequest.newContext({ baseURL: WEB_ORIGIN })
  const response = await bare.post('/api/auth/logout')
  expect(response.status()).toBe(403)
  await bare.dispose()
})
