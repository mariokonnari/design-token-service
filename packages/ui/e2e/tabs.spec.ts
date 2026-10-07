import { expect, test, type Page } from '@playwright/test'
import { openStory, THEMES } from './support/stories'

const DEFAULT = 'components-tabs--default'
const VERTICAL = 'components-tabs--vertical'
const MANUAL = 'components-tabs--manual-activation'
const DISABLED = 'components-tabs--disabled-tab'
const CONTROLLED = 'components-tabs--controlled'

/** Visible text of the tab that has focus, or null when focus is elsewhere. */
async function focusedTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    return el?.getAttribute('role') === 'tab' ? (el.textContent ?? '') : null
  })
}

async function selectedTab(page: Page): Promise<string[]> {
  return page
    .locator('[role="tab"][aria-selected="true"]')
    .evaluateAll((els) => els.map((el) => el.textContent ?? ''))
}

/** What the browser reports for each tab: its tabIndex property, as the user's keyboard sees it. */
async function tabIndexes(page: Page): Promise<Record<string, number>> {
  return page
    .locator('[role="tab"]')
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [el.textContent ?? '', (el as HTMLElement).tabIndex]),
      ),
    )
}

for (const theme of THEMES) {
  test.describe(`Tabs in a real browser [${theme}]`, () => {
    test('roving tabindex: only the selected tab is in the tab order', async ({
      page,
    }) => {
      await openStory(page, DEFAULT, theme)
      expect(await tabIndexes(page)).toEqual({
        Profile: 0,
        Security: -1,
        Billing: -1,
        Notifications: -1,
      })
      // The real tab order: one Tab press lands on the selected tab, the next on its panel.
      await page.keyboard.press('Tab')
      expect(await focusedTab(page)).toBe('Profile')
      await page.keyboard.press('ArrowRight')
      expect(await focusedTab(page)).toBe('Security')
      expect(await tabIndexes(page)).toEqual({
        Profile: -1,
        Security: 0,
        Billing: -1,
        Notifications: -1,
      })
    })

    test('arrow keys, Home and End select as they move and wrap', async ({
      page,
    }) => {
      await openStory(page, DEFAULT, theme)
      await page.keyboard.press('Tab')
      const expectAt = async (name: string) => {
        expect(await focusedTab(page)).toBe(name)
        expect(await selectedTab(page)).toEqual([name])
      }
      await page.keyboard.press('ArrowRight')
      await expectAt('Security')
      await page.keyboard.press('ArrowRight')
      await expectAt('Billing')
      await page.keyboard.press('ArrowRight')
      await expectAt('Notifications')
      await page.keyboard.press('ArrowRight') // wraps
      await expectAt('Profile')
      await page.keyboard.press('ArrowLeft') // wraps backwards
      await expectAt('Notifications')
      await page.keyboard.press('Home')
      await expectAt('Profile')
      await page.keyboard.press('End')
      await expectAt('Notifications')
    })

    test('the disabled tab is skipped and cannot be selected', async ({
      page,
    }) => {
      await openStory(page, DISABLED, theme)
      await page.keyboard.press('Tab')
      await page.keyboard.press('ArrowRight')
      expect(await focusedTab(page)).toBe('Security')
      await page.keyboard.press('ArrowRight') // Billing is disabled
      expect(await focusedTab(page)).toBe('Notifications')
      await page.getByRole('tab', { name: 'Billing' }).click({ force: true })
      expect(await selectedTab(page)).toEqual(['Notifications'])
    })

    test('vertical: Up and Down move; Left and Right do nothing', async ({
      page,
    }) => {
      await openStory(page, VERTICAL, theme)
      expect(
        await page.getByRole('tablist').getAttribute('aria-orientation'),
      ).toBe('vertical')
      await page.keyboard.press('Tab')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
      expect(await focusedTab(page)).toBe('Profile')
      await page.keyboard.press('ArrowDown')
      expect(await focusedTab(page)).toBe('Security')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp') // wraps
      expect(await focusedTab(page)).toBe('Notifications')
    })

    test('manual activation: arrows move focus only, Enter selects', async ({
      page,
    }) => {
      await openStory(page, MANUAL, theme)
      await page.keyboard.press('Tab')
      await page.keyboard.press('ArrowRight')
      expect(await focusedTab(page)).toBe('Security')
      expect(await selectedTab(page)).toEqual(['Profile'])
      await page.keyboard.press('Enter')
      expect(await selectedTab(page)).toEqual(['Security'])
    })

    test('Tab from the selected tab moves focus into the visible panel', async ({
      page,
    }) => {
      await openStory(page, DEFAULT, theme)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      const panel = await page.evaluate(() => {
        const el = document.activeElement
        return {
          role: el?.getAttribute('role'),
          hidden: (el as HTMLElement | null)?.hidden,
          text: el?.textContent,
          labelledBy: el?.getAttribute('aria-labelledby'),
          selectedTabId: document
            .querySelector('[role="tab"][aria-selected="true"]')
            ?.getAttribute('id'),
        }
      })
      expect(panel.role).toBe('tabpanel')
      expect(panel.hidden).toBe(false)
      expect(panel.text).toContain('Profile settings')
      expect(panel.labelledBy).toBe(panel.selectedTabId)
    })

    test('only the selected panel is displayed; the others stay in the DOM, hidden', async ({
      page,
    }) => {
      await openStory(page, DEFAULT, theme)
      const panels = await page
        .locator('[role="tabpanel"]')
        .evaluateAll((els) =>
          els.map((el) => ({
            display: getComputedStyle(el).display,
            hidden: (el as HTMLElement).hidden,
          })),
        )
      expect(panels).toHaveLength(4)
      expect(panels.filter((p) => p.display !== 'none')).toHaveLength(1)
      expect(panels.filter((p) => p.hidden)).toHaveLength(3)
    })

    test('clicking selects, and a controlled parent receives the value', async ({
      page,
    }) => {
      await openStory(page, CONTROLLED, theme)
      await page.getByRole('tab', { name: 'Notifications' }).click()
      expect(await selectedTab(page)).toEqual(['Notifications'])
      await expect(
        page.getByText('Selected value (owned by the parent): notifications'),
      ).toBeVisible()
    })

    for (const forced of [false, true]) {
      test(`the selected tab looks different from the others${forced ? ' under forced colors' : ''}`, async ({
        page,
      }) => {
        if (forced) await page.emulateMedia({ forcedColors: 'active' })
        await openStory(page, DEFAULT, theme)
        if (forced) {
          expect(
            await page.evaluate(
              () => matchMedia('(forced-colors: active)').matches,
            ),
          ).toBe(true)
        }
        const look = (selected: boolean) =>
          page
            .locator(`[role="tab"][aria-selected="${selected}"]`)
            .first()
            .evaluate((el) => {
              const s = getComputedStyle(el)
              return {
                weight: s.fontWeight,
                indicator: s.borderBottomColor,
                indicatorWidth: s.borderBottomWidth,
                indicatorStyle: s.borderBottomStyle,
              }
            })
        const selected = await look(true)
        const other = await look(false)
        // Not color alone: the weight differs, and so does the indicator.
        expect(selected.weight).not.toBe(other.weight)
        expect(Number(selected.weight)).toBeGreaterThan(Number(other.weight))
        expect(selected.indicatorStyle).not.toBe('none')
        expect(parseFloat(selected.indicatorWidth)).toBeGreaterThan(0)
        expect(selected.indicator).not.toBe(other.indicator)
      })
    }
  })
}
