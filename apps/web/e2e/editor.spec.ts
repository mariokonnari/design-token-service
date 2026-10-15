import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createBrandViaApi,
  createOrgViaApi,
  importStarterViaApi,
  logInViaApi,
  ORIGIN_HEADER,
  readStarterTree,
  setUpBrand,
  signUpViaApi,
} from './support/app'
import { expectNoViolations } from './support/axe'
import { WEB_ORIGIN } from './support/ports'
import { addViewer } from './support/viewer'

// The Theme Editor against the BUILT bundle, the REAL API and a real Postgres
// (ADR 0017). Rule for every step here: after any navigation, tab or token
// selection, assert on the new view's heading or a unique element BEFORE typing or
// clicking inside it. Views that share labels (Path, Value, Color (hex)) can be
// matched in the old view while a React transition is pending.

const TOKEN = 'primitive.color.brand.600'
const escape = (text: string) => text.replaceAll('.', '\\.')

async function openBrand(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Summit' }),
  ).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'Tokens and editing' }),
  ).toBeVisible()
}

/** Finds a token with the search box, selects it, and returns its panel once ITS heading is there. */
const TIER_TAB: Record<string, string> = {
  primitive: 'Primitive',
  semantic: 'Semantic',
  component: 'Component',
}

/** Finds a token with the search box, opens its tier, selects it, and returns its panel once ITS heading is there. */
async function selectToken(page: Page, path: string): Promise<Locator> {
  await page.getByRole('searchbox', { name: 'Search tokens' }).fill(path)
  const tab = page.getByRole('tab', {
    name: new RegExp(`^${TIER_TAB[path.split('.')[0] ?? ''] ?? 'Other'} `),
  })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await page
    .getByRole('button', { name: new RegExp(`^${escape(path)} `) })
    .click()
  const region = page.getByRole('region', { name: path })
  await expect(
    region.getByRole('heading', { level: 2, name: path }),
  ).toBeVisible()
  return region
}

const revision = (page: Page) =>
  page
    .locator('dt', { hasText: 'Draft revision' })
    .locator('xpath=following-sibling::dd')

const announcement = (page: Page) =>
  page.getByRole('status', { name: 'Page changes' })

const primaryPreview = (page: Page) =>
  page.getByRole('button', { name: 'Primary action' })

/** A brand with the default theme already in its draft, opened in the editor. */
async function openFilled(page: Page) {
  const brand = await setUpBrand(page)
  const count = await importStarterViaApi(page, brand.org.id, brand.brand.id)
  await openBrand(page, brand.url)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Tokens' }),
  ).toBeVisible()
  return { ...brand, count }
}

function rgbOf(components: number[]): string {
  const [r = 0, g = 0, b = 0] = components.map((c) => Math.round(c * 255))
  return `rgb(${r}, ${g}, ${b})`
}

function starterBrand600(): string {
  const tree = readStarterTree() as {
    primitive: {
      color: { brand: Record<string, { $value: { components: number[] } }> }
    }
  }
  return rgbOf(tree.primitive.color.brand['600']?.$value.components ?? [])
}

test.describe('the draft and the live preview', () => {
  test('start from the default theme, edit a primitive, watch the preview follow, save, reload', async ({
    page,
  }) => {
    const { url } = await setUpBrand(page)
    await openBrand(page, url)
    await expect(page.getByText('This draft has no tokens yet')).toBeVisible()
    await expect(
      page.getByText(/^Library tokens defined: 0 of \d+$/),
    ).toBeVisible()

    await page
      .getByRole('button', { name: 'Start from the default theme' })
      .click()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Tokens' }),
    ).toBeVisible()
    await expect(page.getByText(/imported \d+ tokens/i).first()).toBeVisible()
    // the starter defines every library token: N of N
    await expect(
      page.getByText(/^Library tokens defined: (\d+) of \1$/),
    ).toBeVisible()
    await expect(revision(page)).toHaveText('1')

    const before = starterBrand600()
    await expect(primaryPreview(page)).toHaveCSS('background-color', before)

    const region = await selectToken(page, TOKEN)
    const hex = region.getByLabel(/^Color \(hex\)/)
    await expect(hex).toHaveValue(/^#[0-9a-f]{6}$/)
    await hex.fill('#ff0000')
    // brand.600 -> semantic.color.action.primary -> component.button.bg-primary: two alias hops
    await expect(primaryPreview(page)).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    )

    await region.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(`Saved ${TOKEN}, revision 2`)
    await expect(revision(page)).toHaveText('2')
    await expect(region.getByRole('button', { name: 'Save' })).toBeDisabled()

    await openBrand(page, url)
    await expect(primaryPreview(page)).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    )
    const again = await selectToken(page, TOKEN)
    await expect(again.getByLabel(/^Color \(hex\)/)).toHaveValue('#ff0000')
  })

  test('an invalid hex is a field error with a focused summary, and nothing is saved', async ({
    page,
  }) => {
    const { url } = await openFilled(page)
    const region = await selectToken(page, TOKEN)
    await region.getByLabel(/^Color \(hex\)/).fill('zzz')
    await region.getByRole('button', { name: 'Save' }).click()
    const summary = region.getByRole('alert')
    await expect(summary).toContainText('There is a problem')
    await expect(summary).toBeFocused()
    await expect(region.getByLabel(/^Color \(hex\)/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(revision(page)).toHaveText('1')

    await openBrand(page, url)
    const again = await selectToken(page, TOKEN)
    await expect(again.getByLabel(/^Color \(hex\)/)).not.toHaveValue('zzz')
  })

  test('a token that is missing from the draft falls back to the default theme in the preview', async ({
    page,
  }) => {
    await openFilled(page)
    const edit = await selectToken(page, TOKEN)
    await edit.getByLabel(/^Color \(hex\)/).fill('#ff0000')
    await expect(primaryPreview(page)).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    )
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(`Saved ${TOKEN}, revision 2`)

    // delete the component token the button reads: the variable is no longer defined in the
    // preview scope, so the cascade supplies the default theme's value, not the red chain
    const button = await selectToken(page, 'component.button.bg-primary')
    await button.getByRole('button', { name: 'Delete token' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete token?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(announcement(page)).toHaveText(
      'Deleted component.button.bg-primary, revision 3',
    )
    await expect(primaryPreview(page)).toHaveCSS(
      'background-color',
      starterBrand600(),
    )
  })

  test('the library coverage line counts the draft and lists what is missing on demand', async ({
    page,
  }) => {
    const { url } = await setUpBrand(page)
    await openBrand(page, url)
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    await region.getByLabel(/^Path/).fill('semantic.color.surface')
    await region.getByLabel(/^Type/).selectOption('color')
    await region.getByLabel(/^Color \(hex\)/).fill('#ffffff')
    await region.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(
      'Saved semantic.color.surface, revision 1',
    )
    await expect(
      page.getByText(/^Library tokens defined: 1 of \d+$/),
    ).toBeVisible()

    const toggle = page.getByRole('button', {
      name: 'Show missing library tokens',
    })
    await toggle.click()
    const list = page.getByRole('list', { name: 'Missing library tokens' })
    await expect(list).toBeVisible()
    await expect(
      list.getByText('semantic.color.text', { exact: true }),
    ).toBeVisible()
    await expect(
      list.getByText('semantic.color.surface', { exact: true }),
    ).toHaveCount(0)
  })
})

test.describe('creating, deleting and the draft check', () => {
  test('create a token, then delete it after a confirmation', async ({
    page,
  }) => {
    await openFilled(page)
    const path = 'primitive.color.e2e-new'
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    await region.getByLabel(/^Path/).fill(path)
    await region.getByLabel(/^Type/).selectOption('color')
    await region.getByLabel(/^Color \(hex\)/).fill('#123456')
    await region.getByRole('button', { name: 'Save' }).click()

    const created = page.getByRole('region', { name: path })
    await expect(
      created.getByRole('heading', { level: 2, name: path }),
    ).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`token=${escape(path)}$`))
    await expect(revision(page)).toHaveText('2')

    await created.getByRole('button', { name: 'Delete token' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete token?' })
    await expect(dialog).toBeVisible()
    // cancelling changes nothing
    await dialog.getByRole('button', { name: 'Keep token' }).click()
    await expect(dialog).toBeHidden()
    await expect(revision(page)).toHaveText('2')
    await created.getByRole('button', { name: 'Delete token' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(announcement(page)).toHaveText(`Deleted ${path}, revision 3`)
    await expect(page.getByRole('region', { name: path })).toHaveCount(0)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Tokens' }),
    ).toBeFocused()
    await expect(page).not.toHaveURL(/token=/)
  })

  test('a path that overlaps another token is refused by the server, on the path field', async ({
    page,
  }) => {
    await openFilled(page)
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    const path = region.getByLabel(/^Path/)
    await path.fill('primitive.color.brand')
    await region.getByLabel(/^Type/).selectOption('color')
    await region.getByLabel(/^Color \(hex\)/).fill('#ffffff')
    // the local check already says so, and Save still goes to the server (a draft may be incomplete)
    await expect(region.getByText(/cannot also be a group/i)).toBeVisible()
    await region.getByRole('button', { name: 'Save' }).click()
    await expect(path).toHaveAttribute('aria-invalid', 'true')
    await expect(region.getByRole('alert')).toContainText('There is a problem')
    await expect(region.locator('#token-path-error')).toContainText(
      /overlaps with the existing token primitive\.color\.brand\./,
    )
    await expect(revision(page)).toHaveText('1')
  })

  test('a broken alias shows up in the draft check, with a link to the token', async ({
    page,
  }) => {
    await openFilled(page)
    const path = 'semantic.color.broken'
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    await region.getByLabel(/^Path/).fill(path)
    await region.getByLabel(/^Kind/).selectOption('alias')
    await region.getByLabel(/^Alias target/).fill('primitive.color.nope')
    await expect(region.getByText(/no token has this path/i)).toBeVisible()
    await region.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(`Saved ${path}, revision 2`)

    const check = page.getByRole('region', { name: 'Draft check' })
    await check.getByRole('button', { name: 'Check draft' }).click()
    await expect(
      check.getByText('Draft check: 1 error, 0 warnings'),
    ).toBeVisible()
    await expect(check.getByText('Checked at revision 2')).toBeVisible()
    await check.getByRole('link', { name: path }).click()
    const selected = page.getByRole('region', { name: path })
    await expect(
      selected.getByRole('heading', { level: 2, name: path }),
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`token=${escape(path)}$`))

    // repairing it makes the draft publishable, and only then does the server say so
    const alias = selected.getByLabel(/^Alias target/)
    await expect(alias).toHaveValue('{primitive.color.nope}')
    await alias.fill('primitive.color.brand.600')
    await selected.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(`Saved ${path}, revision 3`)
    await check.getByRole('button', { name: 'Check draft' }).click()
    await expect(check.getByText('Draft check: publishable')).toBeVisible()
  })

  test('the draft is checked on its own a moment after a save', async ({
    page,
  }) => {
    await openFilled(page)
    const region = await selectToken(page, TOKEN)
    await region.getByLabel(/^Color \(hex\)/).fill('#112233')
    await region.getByRole('button', { name: 'Save' }).click()
    const check = page.getByRole('region', { name: 'Draft check' })
    // no click: the automatic check reports the revision the save produced
    await expect(check.getByText('Checked at revision 2')).toBeVisible()
  })
})

test.describe('two sessions, one token', () => {
  test('the second save is a conflict: the typed value stays and overwriting needs a second, explicit click', async ({
    browser,
  }) => {
    const contextA = await browser.newContext({ baseURL: WEB_ORIGIN })
    const contextB = await browser.newContext({ baseURL: WEB_ORIGIN })
    try {
      const a = await contextA.newPage()
      const b = await contextB.newPage()
      const { user, url, org, brand } = await setUpBrand(a)
      await importStarterViaApi(a, org.id, brand.id)
      await logInViaApi(b, user)

      await openBrand(a, url)
      await openBrand(b, url)
      const regionA = await selectToken(a, TOKEN)
      const regionB = await selectToken(b, TOKEN)

      await regionA.getByLabel(/^Color \(hex\)/).fill('#00ff00')
      await regionA.getByRole('button', { name: 'Save' }).click()
      await expect(announcement(a)).toHaveText(`Saved ${TOKEN}, revision 2`)

      // sequenced, not raced: B saves only after A is done
      const hexB = regionB.getByLabel(/^Color \(hex\)/)
      await hexB.fill('#0000ff')
      await regionB.getByRole('button', { name: 'Save' }).click()
      const conflict = regionB.locator('.dts-alert', {
        hasText: 'This token changed since you loaded it',
      })
      await expect(conflict).toBeVisible()
      await expect(conflict).toContainText('#00ff00')
      await expect(hexB).toHaveValue('#0000ff')
      await expect(revision(b)).toHaveText('2')

      await conflict
        .getByRole('button', { name: 'Save over their version' })
        .click()
      await expect(announcement(b)).toHaveText(`Saved ${TOKEN}, revision 3`)
      await expect(conflict).toHaveCount(0)

      await openBrand(a, url)
      const regionAgain = await selectToken(a, TOKEN)
      await expect(regionAgain.getByLabel(/^Color \(hex\)/)).toHaveValue(
        '#0000ff',
      )
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})

test.describe('selection, discarding and the URL', () => {
  test('choosing another token with unsaved edits asks first, in our Dialog', async ({
    page,
  }) => {
    await openFilled(page)
    const region = await selectToken(page, TOKEN)
    await region.getByLabel(/^Color \(hex\)/).fill('#010203')

    await page
      .getByRole('searchbox', { name: 'Search tokens' })
      .fill('primitive.color.brand.700')
    const other = page.getByRole('button', {
      name: /^primitive\.color\.brand\.700 /,
    })
    await other.click()
    const dialog = page.getByRole('dialog', { name: 'Discard changes?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep editing' }).click()
    await expect(dialog).toBeHidden()
    await expect(region.getByLabel(/^Color \(hex\)/)).toHaveValue('#010203')
    await expect(page).toHaveURL(new RegExp(`token=${escape(TOKEN)}$`))

    await other.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Discard changes' }).click()
    const next = page.getByRole('region', { name: 'primitive.color.brand.700' })
    await expect(
      next.getByRole('heading', {
        level: 2,
        name: 'primitive.color.brand.700',
      }),
    ).toBeVisible()
    await expect(next.getByLabel(/^Color \(hex\)/)).not.toHaveValue('#010203')
  })

  for (const [label, value] of [
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['a 10 KB string', 'x'.repeat(10_240)],
    ['a control character', 'a\u0000b'],
    ['encoded slashes', 'a%2Fb'],
    ['markup', '<img src=x onerror=alert(1)>'],
  ] as const) {
    test(`?token= with ${label} is a calm "token not found"`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('dialog', (dialog) => {
        errors.push(`dialog: ${dialog.message()}`)
        void dialog.dismiss()
      })
      const { url } = await openFilled(page)
      await page.goto(`${url}?token=${encodeURIComponent(value)}`)
      await expect(
        page.getByRole('heading', { level: 2, name: 'Token not found' }),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', { level: 2, name: 'Tokens' }),
      ).toBeVisible()
      await expect(page.locator('main img')).toHaveCount(0)
      expect(errors).toEqual([])
      await page.getByRole('link', { name: 'Show all tokens' }).click()
      await expect(
        page.getByRole('heading', { name: 'Token not found' }),
      ).toHaveCount(0)
    })
  }

  test('a deep link opens the token and its tier', async ({ page }) => {
    const { url } = await openFilled(page)
    await page.goto(`${url}?token=component.button.bg-primary`)
    const region = page.getByRole('region', {
      name: 'component.button.bg-primary',
    })
    await expect(
      region.getByRole('heading', {
        level: 2,
        name: 'component.button.bg-primary',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('tab', { name: /^Component \(/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(region.getByLabel(/^Alias target/)).toHaveValue(
      '{semantic.color.action.primary}',
    )
  })
})

test.describe('keyboard', () => {
  test('find, select, edit and save a token without a pointer', async ({
    page,
  }) => {
    await openFilled(page)
    // focus the search box programmatically (no click), type, and move with Tab
    await page.getByRole('searchbox', { name: 'Search tokens' }).focus()
    await page.keyboard.type(TOKEN)
    const item = page.getByRole('button', {
      name: new RegExp(`^${escape(TOKEN)} `),
    })
    await expect(item).toBeVisible()
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      if (await item.evaluate((el) => el === document.activeElement)) break
    }
    await expect(item).toBeFocused()
    await page.keyboard.press('Enter')
    const region = page.getByRole('region', { name: TOKEN })
    await expect(
      region.getByRole('heading', { level: 2, name: TOKEN }),
    ).toBeVisible()

    const hex = region.getByLabel(/^Color \(hex\)/)
    await hex.focus()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('#0a0b0c')
    await expect(primaryPreview(page)).toHaveCSS(
      'background-color',
      'rgb(10, 11, 12)',
    )
    await page.keyboard.press('Enter') // submits the form
    await expect(announcement(page)).toHaveText(`Saved ${TOKEN}, revision 2`)
    await expect(
      region.getByRole('heading', { level: 2, name: TOKEN }),
    ).toBeFocused()
  })
})

test.describe('roles and tenancy', () => {
  test('a Viewer sees values as text and has no way to change anything', async ({
    browser,
  }) => {
    const owner = await browser.newContext({ baseURL: WEB_ORIGIN })
    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN })
    try {
      const ownerPage = await owner.newPage()
      const viewerPage = await viewer.newPage()
      const { url, org, brand } = await setUpBrand(ownerPage)
      await importStarterViaApi(ownerPage, org.id, brand.id)

      const member = await signUpViaApi(viewerPage)
      await addViewer({ email: member.email, organizationId: org.id })

      await openBrand(viewerPage, url)
      await expect(
        viewerPage.getByText(/can look at tokens but not change them/i),
      ).toBeVisible()
      for (const name of [
        'Create token',
        'Start from the default theme',
        'Save',
        'Delete token',
        'Cancel',
      ]) {
        await expect(viewerPage.getByRole('button', { name })).toHaveCount(0)
      }
      const region = await selectToken(viewerPage, TOKEN)
      await expect(region.getByRole('textbox')).toHaveCount(0)
      await expect(region.getByRole('combobox')).toHaveCount(0)
      await expect(region.getByText(/^#[0-9a-f]{6}$/)).toBeVisible()
      // reading is allowed: the draft check works for a Viewer
      await viewerPage.getByRole('button', { name: 'Check draft' }).click()
      await expect(
        viewerPage
          .getByRole('region', { name: 'Draft check' })
          .getByText(/^Draft check: /),
      ).toBeVisible()
      await expectNoViolations(viewerPage, 'editor (Viewer)')
    } finally {
      await owner.close()
      await viewer.close()
    }
  })

  test("another person's brand looks exactly like a missing one", async ({
    browser,
  }) => {
    const first = await browser.newContext({ baseURL: WEB_ORIGIN })
    const second = await browser.newContext({ baseURL: WEB_ORIGIN })
    try {
      const firstPage = await first.newPage()
      const secondPage = await second.newPage()
      const { url } = await setUpBrand(firstPage, 'Private Co')
      await signUpViaApi(secondPage)
      await createOrgViaApi(secondPage, 'Mine')
      await secondPage.goto(url)
      await expect(
        secondPage.getByRole('heading', { level: 1, name: 'Brand not found' }),
      ).toBeVisible()
      await expect(secondPage.getByText('Private Co')).toHaveCount(0)
    } finally {
      await first.close()
      await second.close()
    }
  })

  test('a member of two organizations cannot open one brand through the other organization', async ({
    page,
  }) => {
    const one = await setUpBrand(page, 'First Co')
    const two = await createOrgViaApi(page, 'Second Co')
    await createBrandViaApi(page, two.id, 'Other')
    await page.goto(`/orgs/${two.id}/brands/${one.brand.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Brand not found' }),
    ).toBeVisible()
  })
})

test.describe('axe (wcag2a, wcag2aa, wcag21aa, wcag22aa) on the editor', () => {
  test('empty draft', async ({ page }) => {
    const { url } = await setUpBrand(page)
    await openBrand(page, url)
    await expect(page.getByText('This draft has no tokens yet')).toBeVisible()
    await expectNoViolations(page, 'editor, empty draft')
  })

  test('populated', async ({ page }) => {
    await openFilled(page)
    await expectNoViolations(page, 'editor, populated')
  })

  test('a partial draft with the missing library tokens listed', async ({
    page,
  }) => {
    const { org, brand, url } = await setUpBrand(page)
    const response = await page
      .context()
      .request.post(`/api/orgs/${org.id}/brands/${brand.id}/tokens/import`, {
        data: {
          tree: {
            primitive: {
              color: {
                white: {
                  $type: 'color',
                  $value: { colorSpace: 'srgb', components: [1, 1, 1] },
                },
              },
            },
            semantic: {
              color: { surface: { $value: '{primitive.color.white}' } },
            },
          },
          expectedRevision: 0,
        },
        headers: ORIGIN_HEADER,
      })
    expect(response.status(), await response.text()).toBe(200)
    await openBrand(page, url)
    await expect(
      page.getByText(/^Library tokens defined: 1 of \d+$/),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Show missing library tokens' })
      .click()
    await expect(
      page.getByRole('list', { name: 'Missing library tokens' }),
    ).toBeVisible()
    await expectNoViolations(page, 'editor, missing library tokens listed')
  })

  test('editing, with a local warning, and after a failed save', async ({
    page,
  }) => {
    await openFilled(page)
    const region = await selectToken(page, TOKEN)
    await expectNoViolations(page, 'editor, editing')
    await region.getByLabel(/^Color \(hex\)/).fill('zzz')
    await region.getByRole('button', { name: 'Save' }).click()
    await expect(region.getByRole('alert')).toContainText('There is a problem')
    await expectNoViolations(page, 'editor, error summary')
  })

  test('creating an alias with a missing target (warning state)', async ({
    page,
  }) => {
    await openFilled(page)
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    await region.getByLabel(/^Path/).fill('semantic.color.warn')
    await region.getByLabel(/^Kind/).selectOption('alias')
    await region.getByLabel(/^Alias target/).fill('primitive.color.nope')
    await expect(region.getByText(/no token has this path/i)).toBeVisible()
    await expectNoViolations(page, 'editor, local warning')
  })

  test('the delete dialog open', async ({ page }) => {
    await openFilled(page)
    const region = await selectToken(page, 'primitive.space.4')
    await region.getByRole('button', { name: 'Delete token' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Delete token?' }),
    ).toBeVisible()
    await expectNoViolations(page, 'editor, delete dialog', 'dialog[open]')
  })

  test('the discard dialog open', async ({ page }) => {
    await openFilled(page)
    const region = await selectToken(page, TOKEN)
    await region.getByLabel(/^Color \(hex\)/).fill('#010203')
    await page
      .getByRole('searchbox', { name: 'Search tokens' })
      .fill('primitive.space.4')
    await page.getByRole('button', { name: /^primitive\.space\.4 / }).click()
    await expect(
      page.getByRole('dialog', { name: 'Discard changes?' }),
    ).toBeVisible()
    await expectNoViolations(page, 'editor, discard dialog', 'dialog[open]')
  })

  test('the draft check with issues', async ({ page }) => {
    await openFilled(page)
    await page.getByRole('button', { name: 'Create token' }).click()
    const region = page.getByRole('region', { name: 'New token' })
    await expect(
      region.getByRole('heading', { level: 2, name: 'New token' }),
    ).toBeVisible()
    await region.getByLabel(/^Path/).fill('semantic.color.broken')
    await region.getByLabel(/^Kind/).selectOption('alias')
    await region.getByLabel(/^Alias target/).fill('primitive.color.nope')
    await region.getByRole('button', { name: 'Save' }).click()
    await expect(announcement(page)).toHaveText(
      'Saved semantic.color.broken, revision 2',
    )
    const check = page.getByRole('region', { name: 'Draft check' })
    await check.getByRole('button', { name: 'Check draft' }).click()
    await expect(
      check.getByText('Draft check: 1 error, 0 warnings'),
    ).toBeVisible()
    await expectNoViolations(page, 'editor, draft check with an error')
  })
})

/** The color a system keyword resolves to under the emulated forced-colors palette. */
function systemColor(page: Page, keyword: string): Promise<string> {
  return page.evaluate((k) => {
    const probe = document.createElement('div')
    probe.style.color = k
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, keyword)
}

test.describe('forced colors', () => {
  test('borders and the focus outline are drawn with system colors', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    ).toBe(true)
    await openFilled(page)
    const region = await selectToken(page, TOKEN)

    const canvasText = await systemColor(page, 'CanvasText')
    const highlight = await systemColor(page, 'Highlight')
    const panelBorder = await region.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        color: style.borderTopColor,
        width: style.borderTopWidth,
        style: style.borderTopStyle,
      }
    })
    expect(panelBorder.style).not.toBe('none')
    expect(panelBorder.color).toBe(canvasText)

    // the selected list item: Highlight border, and a keyboard focus ring in Highlight
    const item = page.getByRole('button', {
      name: new RegExp(`^${escape(TOKEN)} `),
    })
    await expect(item).toHaveAttribute('aria-current', 'true')
    await expect(item).toHaveCSS('border-top-color', highlight)
    await page.keyboard.press('Tab')
    await item.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(item).toBeFocused()
    const outline = await item.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        style: style.outlineStyle,
        color: style.outlineColor,
        width: style.outlineWidth,
      }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.color).toBe(highlight)
    expect(parseFloat(outline.width)).toBeGreaterThan(0)
  })
})
