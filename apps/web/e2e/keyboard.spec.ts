import { expect, test } from '@playwright/test'
import { newUser, uniqueSlug } from './support/app'

// Keyboard ONLY: no click(), no fill(), no locator.focus(). Everything is Tab,
// typed characters and Enter, the way a person who cannot use a mouse does it.

test('sign up and create an organization using only the keyboard', async ({
  page,
}) => {
  const user = newUser()
  const slug = uniqueSlug('kbd')

  await page.goto('/signup')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create an account' }),
  ).toBeVisible()

  // The first tab stop is the skip link; it works.
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: /skip to main content/i })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^email/i)).toBeFocused()
  await page.keyboard.type(user.email)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^password/i)).toBeFocused()
  await page.keyboard.type(user.password)
  await page.keyboard.press('Enter')

  // Signed in; focus moved to the new page's heading (route change announced).
  const heading = page.getByRole('heading', { level: 1, name: 'Organizations' })
  await expect(heading).toBeVisible()
  await expect(heading).toBeFocused()

  // From the heading, Tab reaches the organization form (an empty list has no links).
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^name/i)).toBeFocused()
  await page.keyboard.type('Keyboard Co')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^slug/i)).toBeFocused()
  // select the suggested slug and replace it
  await page.keyboard.press('Control+A')
  await page.keyboard.type(slug)
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('link', { name: 'Keyboard Co' })).toBeVisible()
  await expect(
    page.getByText(/created organization.*keyboard co/i),
  ).toBeVisible()
})

test('the skip link moves focus past the header to the main content', async ({
  page,
}) => {
  await page.goto('/login')
  // the form mounts once the session check has answered; keys typed before are lost
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: /skip to main content/i }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
  // the next Tab lands inside the main content, on the first field
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^email/i)).toBeFocused()
})

test('after a failed sign-in the keyboard goes from the error summary on to the form', async ({
  page,
}) => {
  await page.goto('/login')
  // the form mounts once the session check has answered; keys typed before are lost
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible()
  await page.keyboard.press('Tab') // skip link
  await page.keyboard.press('Tab') // email
  await page.keyboard.type('nobody@example.test')
  await page.keyboard.press('Tab')
  await page.keyboard.type('not the password')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText(
    'Invalid email or password.',
  )
  await expect(page.getByRole('alert')).toBeFocused()
  // Tab from the summary goes on to the form's first field
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/^email/i)).toBeFocused()
})
