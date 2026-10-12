import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { WEB_ORIGIN } from './ports'

/**
 * Helpers for the real-stack specs. Every test makes its OWN user and slugs, so two
 * workers sharing one API and one database never see each other's data.
 */

export const PASSWORD = 'correct horse battery staple'

export interface TestUser {
  email: string
  password: string
}

const token = () => randomUUID().replaceAll('-', '').slice(0, 10)

export function newUser(): TestUser {
  return { email: `user-${token()}@example.test`, password: PASSWORD }
}

/** A valid slug, unique per call. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${token()}`
}

/** The Origin header the API's CSRF check needs on every state-changing call made outside the page. */
export const ORIGIN_HEADER = { Origin: WEB_ORIGIN }

/** Signs up through the API (fast); the session cookie lands in the browser context's jar. */
export async function signUpViaApi(
  page: Page,
  user = newUser(),
): Promise<TestUser> {
  const response = await page.context().request.post('/api/auth/signup', {
    data: user,
    headers: ORIGIN_HEADER,
  })
  expect(response.status(), await response.text()).toBe(201)
  return user
}

/** Signs up through the page and waits for the organization list. */
export async function signUpViaUi(
  page: Page,
  user = newUser(),
): Promise<TestUser> {
  await page.goto('/signup')
  await page.getByLabel(/^email/i).fill(user.email)
  await page.getByLabel(/^password/i).fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible()
  return user
}

export async function logInViaUi(page: Page, user: TestUser): Promise<void> {
  await page.getByLabel(/^email/i).fill(user.email)
  await page.getByLabel(/^password/i).fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function createOrgViaApi(
  page: Page,
  name: string,
  slug = uniqueSlug('org'),
): Promise<{ id: string; slug: string; name: string }> {
  const response = await page.context().request.post('/api/orgs', {
    data: { name, slug },
    headers: ORIGIN_HEADER,
  })
  expect(response.status(), await response.text()).toBe(201)
  const body = (await response.json()) as {
    organization: { id: string; slug: string; name: string }
  }
  return body.organization
}

export async function createBrandViaApi(
  page: Page,
  orgId: string,
  name: string,
  slug = uniqueSlug('brand'),
): Promise<{ id: string; slug: string; name: string }> {
  const response = await page
    .context()
    .request.post(`/api/orgs/${orgId}/brands`, {
      data: { name, slug },
      headers: ORIGIN_HEADER,
    })
  expect(response.status(), await response.text()).toBe(201)
  const body = (await response.json()) as {
    brand: { id: string; slug: string; name: string }
  }
  return body.brand
}

/** Creates an organization through the form on the organization list. */
export async function createOrgViaUi(
  page: Page,
  name: string,
  slug?: string,
): Promise<void> {
  await page.getByLabel(/^name/i).fill(name)
  if (slug !== undefined) await page.getByLabel(/^slug/i).fill(slug)
  await page.getByRole('button', { name: 'Create organization' }).click()
}

export async function createBrandViaUi(
  page: Page,
  name: string,
  slug?: string,
): Promise<void> {
  await page.getByLabel(/^name/i).fill(name)
  if (slug !== undefined) await page.getByLabel(/^slug/i).fill(slug)
  await page.getByRole('button', { name: 'Create brand' }).click()
}

/** The value of the session cookie in this browser context (the cookie is HttpOnly: only the context can read it). */
export async function sessionCookie(page: Page) {
  const cookies = await page.context().cookies()
  return cookies.find((cookie) => cookie.name === 'dts_session')
}
