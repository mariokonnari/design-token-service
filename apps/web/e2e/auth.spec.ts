import { expect, test } from '@playwright/test'
import { logInViaUi, newUser, signUpViaApi, signUpViaUi } from './support/app'
import { WEB_ORIGIN } from './support/ports'

const orgListHeading = (page: import('@playwright/test').Page) =>
  page.getByRole('heading', { level: 1, name: 'Organizations' })

test('signing up lands on the organization list, signed in', async ({
  page,
}) => {
  const user = newUser()
  await signUpViaUi(page, user)
  await expect(page).toHaveURL('/')
  await expect(page.getByText(user.email)).toBeVisible()
  await expect(
    page.getByText(/not a member of any organization yet/i),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
})

test('logging out returns to sign in and the session is really gone', async ({
  page,
}) => {
  await signUpViaUi(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await expect(page).toHaveURL('/login')

  // the protected page is no longer reachable without signing in again
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  const me = await page.request.get('/api/me')
  expect(me.status()).toBe(401)
})

test('logging in again works and shows the organization list', async ({
  page,
}) => {
  const user = await signUpViaApi(page)
  await page.context().clearCookies()
  await page.goto('/login')
  await logInViaUi(page, user)
  await expect(orgListHeading(page)).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('a wrong password is ONE generic message, and an unknown email gets the same', async ({
  page,
}) => {
  const user = await signUpViaApi(page)
  await page.context().clearCookies()

  await page.goto('/login')
  await logInViaUi(page, { ...user, password: 'definitely the wrong one' })
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Invalid email or password.')
  await expect(alert).toBeFocused()
  await expect(page).toHaveURL('/login')
  const wrongPasswordText = await alert.innerText()

  await page.reload()
  await logInViaUi(page, { email: newUser().email, password: 'whatever it is' })
  await expect(page.getByRole('alert')).toContainText(
    'Invalid email or password.',
  )
  expect(await page.getByRole('alert').innerText()).toBe(wrongPasswordText)
  // neither field is singled out
  await expect(page.getByLabel(/^email/i)).not.toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await expect(page.getByLabel(/^password/i)).not.toHaveAttribute(
    'aria-invalid',
    'true',
  )
})

test('an unauthenticated deep link goes to /login?next=… and returns there after signing in', async ({
  page,
}) => {
  const user = await signUpViaApi(page)
  await page.context().clearCookies()

  const wanted = '/orgs/00000000-0000-4000-8000-000000000000'
  await page.goto(wanted)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(wanted)}`)

  await logInViaUi(page, user)
  // an organization this user is not in: the app returned to the wanted page, which says "not found"
  await expect(page).toHaveURL(wanted)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization not found' }),
  ).toBeVisible()
})

test.describe('a hostile ?next= is ignored', () => {
  const HOSTILE = [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '/%2F%2Fevil.example',
  ]
  for (const value of HOSTILE) {
    test(`next=${value}`, async ({ page }) => {
      const user = await signUpViaApi(page)
      await page.context().clearCookies()

      const requests: string[] = []
      page.on('request', (request) => requests.push(request.url()))
      await page.goto(`/login?next=${encodeURIComponent(value)}`)
      await logInViaUi(page, user)

      await expect(orgListHeading(page)).toBeVisible()
      const url = new URL(page.url())
      expect(url.origin).toBe(WEB_ORIGIN)
      expect(url.pathname).toBe('/')
      // no request at all went anywhere but this app's own origin
      expect(requests.filter((u) => new URL(u).origin !== WEB_ORIGIN)).toEqual(
        [],
      )
    })
  }
})

test('a visitor who is already signed in is sent home from /login and /signup', async ({
  page,
}) => {
  await signUpViaApi(page)
  await page.goto('/login')
  await expect(orgListHeading(page)).toBeVisible()
  await expect(page).toHaveURL('/')
  await page.goto('/signup')
  await expect(orgListHeading(page)).toBeVisible()
})

test('signing up twice with one email shows an error on the email field', async ({
  page,
}) => {
  const user = await signUpViaApi(page)
  await page.context().clearCookies()
  await page.goto('/signup')
  await page.getByLabel(/^email/i).fill(user.email)
  await page.getByLabel(/^password/i).fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  const email = page.getByLabel(/^email/i)
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveAccessibleDescription(/already exists/i)
  await expect(page.getByRole('alert')).toBeFocused()
})

test('client-side checks catch an empty form without a request', async ({
  page,
}) => {
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url())
  })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('alert')).toContainText(
    'Enter your email address.',
  )
  expect(posts).toEqual([])
})
