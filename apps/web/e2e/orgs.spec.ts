import { expect, test } from '@playwright/test'
import {
  createBrandViaApi,
  createBrandViaUi,
  createOrgViaApi,
  createOrgViaUi,
  signUpViaApi,
  signUpViaUi,
  uniqueSlug,
} from './support/app'
import { WEB_ORIGIN } from './support/ports'

test('creating an organization adds it to the list and confirms', async ({
  page,
}) => {
  await signUpViaUi(page)
  const slug = uniqueSlug('acme')
  await createOrgViaUi(page, 'Acme Labs', slug)

  const link = page.getByRole('link', { name: 'Acme Labs' })
  await expect(link).toBeVisible()
  await expect(page.getByText(/created organization.*acme labs/i)).toBeVisible()
  await expect(page.getByText(slug)).toBeVisible()
  await expect(page.getByLabel(/^name/i)).toHaveValue('')

  // it is really stored: it survives a reload
  await page.reload()
  await expect(page.getByRole('link', { name: 'Acme Labs' })).toBeVisible()
})

test('the slug follows the name until it is edited by hand', async ({
  page,
}) => {
  await signUpViaUi(page)
  await page.getByLabel(/^name/i).fill('Café Münch')
  await expect(page.getByLabel(/^slug/i)).toHaveValue('cafe-munch')
  await page.getByLabel(/^slug/i).fill('mine')
  await page.getByLabel(/^name/i).fill('Something else')
  await expect(page.getByLabel(/^slug/i)).toHaveValue('mine')
})

test('a duplicate organization slug is an error on the slug field', async ({
  page,
}) => {
  await signUpViaUi(page)
  const slug = uniqueSlug('dup')
  await createOrgViaUi(page, 'First', slug)
  await expect(page.getByRole('link', { name: 'First' })).toBeVisible()

  await createOrgViaUi(page, 'Second', slug)
  const slugField = page.getByLabel(/^slug/i)
  await expect(slugField).toHaveAttribute('aria-invalid', 'true')
  await expect(slugField).toHaveAccessibleDescription(/already in use/i)
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('alert')).toContainText(
    'This slug is already in use',
  )
  // nothing was added, and what the person typed is still there
  await expect(page.getByRole('link', { name: 'Second' })).toHaveCount(0)
  await expect(page.getByLabel(/^name/i)).toHaveValue('Second')
})

test('a 64-character slug is refused in the browser (63 is the limit), 63 is accepted', async ({
  page,
}) => {
  await signUpViaUi(page)
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url())
  })

  await createOrgViaUi(page, 'Long', 'a'.repeat(64))
  await expect(page.getByLabel(/^slug/i)).toHaveAccessibleDescription(
    /at most 63/i,
  )
  expect(posts).toEqual([])

  await page.getByLabel(/^slug/i).fill('b'.repeat(63))
  await page.getByRole('button', { name: 'Create organization' }).click()
  await expect(page.getByRole('link', { name: 'Long' })).toBeVisible()
})

test('creating a brand: list, confirmation, and the editor page', async ({
  page,
}) => {
  await signUpViaApi(page)
  const org = await createOrgViaApi(page, 'Globex')
  await page.goto(`/orgs/${org.id}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Globex' }),
  ).toBeVisible()
  await expect(page.getByText(/no brands yet/i)).toBeVisible()

  const slug = uniqueSlug('summit')
  await createBrandViaUi(page, 'Summit', slug)
  const link = page.getByRole('link', { name: 'Summit' })
  await expect(link).toBeVisible()
  await expect(page.getByText(/created brand.*summit/i)).toBeVisible()

  await link.click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Summit' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Summit' }),
  ).toBeFocused()
  await expect(
    page.getByRole('button', { name: 'Start from the default theme' }),
  ).toBeVisible()
  await expect(page).toHaveURL(
    new RegExp(`/orgs/${org.id}/brands/[0-9a-f-]{36}$`),
  )

  // the breadcrumb leads back
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Globex' })
    .click()
  await expect(page.getByRole('link', { name: 'Summit' })).toBeVisible()
})

test('a duplicate brand slug is an error on the slug field', async ({
  page,
}) => {
  await signUpViaApi(page)
  const org = await createOrgViaApi(page, 'Initech')
  const slug = uniqueSlug('dupe')
  await createBrandViaApi(page, org.id, 'First brand', slug)
  await page.goto(`/orgs/${org.id}`)

  await createBrandViaUi(page, 'Second brand', slug)
  const slugField = page.getByLabel(/^slug/i)
  await expect(slugField).toHaveAttribute('aria-invalid', 'true')
  await expect(slugField).toHaveAccessibleDescription(/already in use/i)
  await expect(page.getByRole('alert')).toBeFocused()
})

test("someone else's organization and brand look exactly like a missing one", async ({
  page,
  browser,
}) => {
  // user A owns an organization with a brand
  await signUpViaApi(page)
  const org = await createOrgViaApi(page, 'Private Co')
  const brand = await createBrandViaApi(page, org.id, 'Secret Brand')

  // user B, in a separate browser context, asks for A's URLs
  const other = await browser.newContext({ baseURL: WEB_ORIGIN })
  const stranger = await other.newPage()
  await signUpViaApi(stranger)
  await stranger.goto(`/orgs/${org.id}`)
  await expect(
    stranger.getByRole('heading', { level: 1, name: 'Organization not found' }),
  ).toBeVisible()
  await expect(stranger.getByText('Private Co')).toHaveCount(0)

  await stranger.goto(`/orgs/${org.id}/brands/${brand.id}`)
  await expect(
    stranger.getByRole('heading', { level: 1, name: /not found/i }),
  ).toBeVisible()
  await expect(stranger.getByText('Secret Brand')).toHaveCount(0)

  // and an invented id looks the same
  await stranger.goto('/orgs/00000000-0000-4000-8000-000000000000')
  await expect(
    stranger.getByRole('heading', { level: 1, name: 'Organization not found' }),
  ).toBeVisible()
  await other.close()
})

test('an unknown address shows the not-found page', async ({ page }) => {
  await page.goto('/this/does/not/exist')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible()
  await expect(page).toHaveTitle('Page not found – Design Token Service')
})

test('names with markup are shown as text, never executed', async ({
  page,
}) => {
  await signUpViaUi(page)
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  const hostile = '<img src=x onerror="alert(1)"> Evil'
  await createOrgViaUi(page, hostile, uniqueSlug('evil'))
  await expect(page.getByRole('link', { name: /Evil/ })).toHaveText(hostile)
  await expect(page.locator('main img')).toHaveCount(0)
  expect(dialogs).toEqual([])
})
