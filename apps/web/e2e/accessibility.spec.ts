import { expect, test, type Page } from '@playwright/test'
import {
  describeViolations,
  evaluatedNodes,
  incompleteNodes,
  runAxe,
} from './support/axe'
import {
  createBrandViaApi,
  createOrgViaApi,
  newUser,
  signUpViaApi,
  uniqueSlug,
} from './support/app'

// Real-pixel checks of the pages in Chromium: axe with WCAG 2.0 A/AA, 2.1 AA and
// 2.2 AA tags (including color-contrast on the rendered, themed pixels), link
// styling that does not depend on color alone, and focus visibility. Not covered:
// screen readers, hover states, forced colors and reduced motion on these pages,
// other browsers (ADR 0016).

async function expectNoViolations(page: Page, what: string): Promise<void> {
  const results = await runAxe(page)
  expect(
    results.violations.length,
    `${what}\n${describeViolations(results)}`,
  ).toBe(0)
  // "incomplete" means axe could not decide: a contrast failure could hide there
  expect(
    incompleteNodes(results, 'color-contrast'),
    `${what}: axe could not decide color-contrast for some nodes`,
  ).toBe(0)
  // not vacuous: contrast was really measured on this page
  expect(
    evaluatedNodes(results, 'color-contrast'),
    `${what}: no text was evaluated`,
  ).toBeGreaterThan(0)
}

test.describe('axe (wcag2a, wcag2aa, wcag21aa, wcag22aa)', () => {
  test('login', async ({ page }) => {
    await page.goto('/login')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeVisible()
    await expectNoViolations(page, 'login')
  })

  test('signup', async ({ page }) => {
    await page.goto('/signup')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create an account' }),
    ).toBeVisible()
    await expectNoViolations(page, 'signup')
  })

  test('organization list (with an organization and the create form)', async ({
    page,
  }) => {
    await signUpViaApi(page)
    await createOrgViaApi(page, 'Acme Labs')
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Acme Labs' })).toBeVisible()
    await expectNoViolations(page, 'organization list')
  })

  test('brand list (with a brand and the create form)', async ({ page }) => {
    await signUpViaApi(page)
    const org = await createOrgViaApi(page, 'Globex')
    await createBrandViaApi(page, org.id, 'Summit')
    await page.goto(`/orgs/${org.id}`)
    await expect(page.getByRole('link', { name: 'Summit' })).toBeVisible()
    await expectNoViolations(page, 'brand list')
  })

  test('brand placeholder page', async ({ page }) => {
    await signUpViaApi(page)
    const org = await createOrgViaApi(page, 'Initech')
    const brand = await createBrandViaApi(page, org.id, 'Summit')
    await page.goto(`/orgs/${org.id}/brands/${brand.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Summit' }),
    ).toBeVisible()
    await expectNoViolations(page, 'brand page')
  })

  test('not-found page', async ({ page }) => {
    await page.goto('/nothing/here')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible()
    await expectNoViolations(page, 'not found')
  })

  test('error state: wrong password (alert) and client-side field errors', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Enter your email address.',
    )
    await expectNoViolations(page, 'login with field errors')

    await page.getByLabel(/^email/i).fill(newUser().email)
    await page.getByLabel(/^password/i).fill('wrong password here')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Invalid email or password.',
    )
    await expectNoViolations(page, 'login with the generic error')
  })

  test('error state: the create-organization form with a server error on the slug', async ({
    page,
  }) => {
    await signUpViaApi(page)
    const slug = uniqueSlug('taken')
    await createOrgViaApi(page, 'Taken Co', slug)
    await page.goto('/')
    await page.getByLabel(/^name/i).fill('Another')
    await page.getByLabel(/^slug/i).fill(slug)
    await page.getByRole('button', { name: 'Create organization' }).click()
    await expect(page.getByLabel(/^slug/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expectNoViolations(page, 'create organization with a taken slug')
  })
})

test.describe('links do not rely on color alone and show focus', () => {
  async function inTextLinks(page: Page) {
    const links = page.locator('main a')
    const count = await links.count()
    expect(
      count,
      'the page must have at least one link in its content',
    ).toBeGreaterThan(0)
    return { links, count }
  }

  async function expectUnderlined(page: Page, what: string) {
    const { links, count } = await inTextLinks(page)
    for (let index = 0; index < count; index++) {
      const decoration = await links
        .nth(index)
        .evaluate((el) => getComputedStyle(el).textDecorationLine)
      expect(
        decoration,
        `${what}: link #${index} text-decoration-line`,
      ).toContain('underline')
    }
  }

  test('login, signup, 404', async ({ page }) => {
    for (const [path, what] of [
      ['/login', 'login'],
      ['/signup', 'signup'],
      ['/nowhere', 'not found'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectUnderlined(page, what)
    }
  })

  test('organization list, brand list, brand page', async ({ page }) => {
    await signUpViaApi(page)
    const org = await createOrgViaApi(page, 'Link Co')
    const brand = await createBrandViaApi(page, org.id, 'Link Brand')

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Link Co' })).toBeVisible()
    await expectUnderlined(page, 'organization list')

    await page.goto(`/orgs/${org.id}`)
    await expect(page.getByRole('link', { name: 'Link Brand' })).toBeVisible()
    await expectUnderlined(page, 'brand list')

    await page.goto(`/orgs/${org.id}/brands/${brand.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Link Brand' }),
    ).toBeVisible()
    await expectUnderlined(page, 'brand page')
  })

  test('a keyboard-focused link has a visible outline', async ({ page }) => {
    await page.goto('/login')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeVisible()
    const link = page.getByRole('link', { name: /create an account/i })
    // reach it by Tab only
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press('Tab')
      if (await link.evaluate((el) => el === document.activeElement)) break
    }
    await expect(link).toBeFocused()
    const outline = await link.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        focusVisible: el.matches(':focus-visible'),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
      }
    })
    expect(outline.focusVisible).toBe(true)
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)
    expect(outline.color).not.toBe('rgba(0, 0, 0, 0)')
    expect(outline.color).not.toBe('transparent')
  })
})

test.describe('structure', () => {
  test('every page has one h1 and a matching document title; focus follows navigation', async ({
    page,
  }) => {
    await signUpViaApi(page)
    const org = await createOrgViaApi(page, 'Title Co')
    await createBrandViaApi(page, org.id, 'Title Brand')

    await page.goto('/')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Organizations' }),
    ).toBeVisible()
    await expect(page).toHaveTitle('Organizations – Design Token Service')
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)

    await page.getByRole('link', { name: 'Title Co' }).click()
    const heading = page.getByRole('heading', { level: 1, name: 'Title Co' })
    await expect(heading).toBeFocused()
    await expect(page).toHaveTitle('Title Co – Design Token Service')
    await expect(
      page.getByRole('status', { name: /page changes|navigation/i }),
    ).toContainText('Title Co')

    await page.getByRole('link', { name: 'Title Brand' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Title Brand' }),
    ).toBeFocused()
    await expect(page).toHaveTitle('Title Brand – Design Token Service')
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
  })
})
