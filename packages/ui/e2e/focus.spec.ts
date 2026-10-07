import { expect, test, type Locator, type Page } from '@playwright/test'
import { openStory, THEMES } from './support/stories'

interface Target {
  name: string
  story: string
  allStory: string
  selector: string
}

const TARGETS: Target[] = [
  {
    name: 'Button',
    story: 'components-button--primary',
    allStory: 'components-button--all',
    selector: '.dts-button',
  },
  {
    name: 'TextField input',
    story: 'components-textfield--default',
    allStory: 'components-textfield--all',
    selector: '.dts-textfield__input',
  },
  {
    name: 'Checkbox input',
    story: 'components-checkbox--default',
    allStory: 'components-checkbox--all',
    selector: '.dts-checkbox__input',
  },
]

async function expectFocusRing(control: Locator, what: string): Promise<void> {
  await expect(control, `${what} must be focused`).toBeFocused()
  const info = await control.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      focusVisible: el.matches(':focus-visible'),
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      color: style.outlineColor,
    }
  })
  expect(info.focusVisible, `${what}: :focus-visible must match`).toBe(true)
  expect(info.style, `${what}: outline-style`).not.toBe('none')
  expect(info.width, `${what}: outline-width`).toBeGreaterThanOrEqual(2)
  expect(info.color, `${what}: outline-color`).not.toBe('rgba(0, 0, 0, 0)')
  expect(info.color, `${what}: outline-color`).not.toBe('transparent')
}

/** Moves focus into the page with the keyboard only (never locator.focus()). */
async function tabTo(page: Page, control: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    if (await control.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error('Tab never reached the control')
}

for (const theme of THEMES) {
  for (const target of TARGETS) {
    test(`Tab shows the focus ring on the ${target.name} [${theme}]`, async ({
      page,
    }) => {
      await openStory(page, target.story, theme)
      const control = page.locator(target.selector).first()
      await tabTo(page, control)
      await expectFocusRing(control, target.name)
    })

    test(`every ${target.name} in the All story shows the ring when reached by Tab [${theme}]`, async ({
      page,
    }) => {
      await openStory(page, target.allStory, theme)
      const enabled = page.locator(`${target.selector}:not(:disabled)`)
      const count = await enabled.count()
      expect(
        count,
        'the All story must have several enabled controls',
      ).toBeGreaterThan(1)
      for (let i = 0; i < count; i++) {
        const control = enabled.nth(i)
        await tabTo(page, control)
        await expectFocusRing(control, `${target.name} #${i + 1}`)
      }
    })
  }

  // Tabs use a roving tabindex, so Tab only reaches the selected tab; the
  // others are reached with the arrow keys and then the panel with Tab.
  test(`Tabs: the ring shows on the selected tab, on the next tab after an arrow key, and on the panel [${theme}]`, async ({
    page,
  }) => {
    await openStory(page, 'components-tabs--default', theme)
    const selected = page.locator('[role="tab"][aria-selected="true"]')
    await tabTo(page, selected)
    await expectFocusRing(selected, 'selected Tab')

    await page.keyboard.press('ArrowRight')
    const next = page.getByRole('tab', { name: 'Security' })
    await expectFocusRing(next, 'Tab reached by ArrowRight')

    await page.keyboard.press('Tab')
    const panel = page.locator('[role="tabpanel"]:not([hidden])')
    await expectFocusRing(panel, 'TabPanel')
  })
}
