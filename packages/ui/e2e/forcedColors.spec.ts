import { expect, test, type Page } from '@playwright/test'
import { describeViolations, runAxe } from './support/axe'
import {
  label,
  openStory,
  storiesOf,
  THEMES,
  type StoryEntry,
} from './support/stories'

/**
 * Forced colors (Windows High Contrast) replaces author colors with a small
 * system palette. What we can and cannot prove in Chromium (ADR 0010):
 * - Chromium already forces border, outline and disabled colors on its own, so
 *   "a border is still drawn" does not prove our rules. We therefore also assert
 *   the RESOLVED system color where our CSS picks one deliberately;
 * - some of our forced-colors rules (Alert border and icon, Button border,
 *   disabled Button and TextField) are indistinguishable from the browser's own
 *   behaviour in Chromium; they are kept for engines that behave differently.
 */

const COMPONENTS = ['Alert', 'Button', 'Checkbox', 'TextField']

type SystemKeyword = 'CanvasText' | 'ButtonText' | 'Highlight' | 'GrayText'

/** The color a system keyword resolves to in the current (emulated) palette. */
async function systemColor(
  page: Page,
  keyword: SystemKeyword,
): Promise<string> {
  return page.evaluate((k) => {
    const probe = document.createElement('div')
    probe.style.color = k
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, keyword)
}

async function canvasColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'Canvas'
    document.body.append(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    return resolved
  })
}

interface Computed {
  borderStyle: string
  borderWidth: number
  borderColor: string
  outlineColor: string
  color: string
  accent: string
}

async function computed(page: Page, selector: string): Promise<Computed[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el)
      return {
        borderStyle: s.borderTopStyle,
        borderWidth: parseFloat(s.borderTopWidth),
        borderColor: s.borderTopColor,
        outlineColor: s.outlineColor,
        color: s.color,
        accent: s.accentColor,
      }
    }),
  )
}

async function expectDrawnBorder(
  page: Page,
  selector: string,
  expectedColor: SystemKeyword,
  what: string,
): Promise<void> {
  const items = await computed(page, selector)
  expect(items.length, `${what}: nothing matched ${selector}`).toBeGreaterThan(
    0,
  )
  const expected = await systemColor(page, expectedColor)
  for (const item of items) {
    expect(item.borderStyle, `${what}: border-style`).not.toBe('none')
    expect(item.borderWidth, `${what}: border-width`).toBeGreaterThan(0)
    expect(item.borderColor, `${what}: border-color is ${expectedColor}`).toBe(
      expected,
    )
  }
}

async function forStory(
  page: Page,
  story: StoryEntry,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await page.emulateMedia({ forcedColors: 'active' })
  await openStory(page, story.id, theme)
  expect(
    await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    'forced colors must really be active',
  ).toBe(true)
}

for (const component of COMPONENTS) {
  for (const story of storiesOf(component)) {
    for (const theme of THEMES) {
      test(`forced colors, axe and drawn borders: ${label(story, theme)}`, async ({
        page,
      }) => {
        await forStory(page, story, theme)

        const results = await runAxe(page)
        expect(results.violations.length, describeViolations(results)).toBe(0)

        const has = async (selector: string) =>
          (await page.locator(selector).count()) > 0

        if (component === 'Alert') {
          await expectDrawnBorder(page, '.dts-alert', 'CanvasText', 'Alert')
          const icons = await computed(page, '.dts-alert__icon')
          const text = await systemColor(page, 'CanvasText')
          for (const icon of icons) expect(icon.color).toBe(text)
        }

        if (component === 'Button') {
          if (await has('.dts-button:not(:disabled)')) {
            await expectDrawnBorder(
              page,
              '.dts-button:not(:disabled)',
              'ButtonText',
              'Button',
            )
          }
          expect(
            await page.locator('.dts-button').count(),
            'no Button rendered',
          ).toBeGreaterThan(0)
          if (await has('.dts-button:disabled')) {
            const gray = await systemColor(page, 'GrayText')
            for (const b of await computed(page, '.dts-button:disabled')) {
              expect(b.color, 'disabled Button text').toBe(gray)
              expect(b.borderStyle).not.toBe('none')
            }
          }
        }

        if (component === 'TextField') {
          const valid =
            '.dts-textfield__input:not(:disabled):not([aria-invalid=true])'
          if (await has(valid)) {
            await expectDrawnBorder(page, valid, 'CanvasText', 'TextField')
          }
          const invalid = '.dts-textfield__input[aria-invalid=true]'
          if (await has(invalid)) {
            // Our rule: the invalid state keeps a distinct system color.
            await expectDrawnBorder(
              page,
              invalid,
              'Highlight',
              'invalid TextField',
            )
          }
          if (await has('.dts-textfield__input:disabled')) {
            const gray = await systemColor(page, 'GrayText')
            for (const i of await computed(
              page,
              '.dts-textfield__input:disabled',
            )) {
              expect(i.color, 'disabled TextField text').toBe(gray)
              expect(i.borderStyle).not.toBe('none')
            }
          }
        }

        if (component === 'Checkbox') {
          // The box is drawn by the browser; our rule tints it with Highlight.
          const highlight = await systemColor(page, 'Highlight')
          for (const c of await computed(
            page,
            '.dts-checkbox__input:not(:disabled)',
          )) {
            expect(c.accent, 'checkbox accent-color').toBe(highlight)
          }
          if (
            await has('.dts-checkbox__label:has(.dts-checkbox__input:disabled)')
          ) {
            const gray = await systemColor(page, 'GrayText')
            for (const l of await computed(
              page,
              '.dts-checkbox__label:has(.dts-checkbox__input:disabled)',
            )) {
              expect(l.color, 'disabled Checkbox label').toBe(gray)
            }
          }
        }
      })
    }
  }
}

const FOCUS_TARGETS = [
  ['components-button--primary', '.dts-button'],
  ['components-textfield--default', '.dts-textfield__input'],
  ['components-checkbox--default', '.dts-checkbox__input'],
] as const

for (const [storyId, selector] of FOCUS_TARGETS) {
  for (const theme of THEMES) {
    test(`forced colors: the focus ring is still drawn by Tab: ${storyId} [${theme}]`, async ({
      page,
    }) => {
      await forStory(page, { id: storyId, title: '', name: '' }, theme)
      const control = page.locator(selector).first()
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab')
        if (await control.evaluate((el) => el === document.activeElement)) break
      }
      await expect(control).toBeFocused()
      const ring = await control.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
          color: s.outlineColor,
        }
      })
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      // Visible against the canvas it is drawn on.
      expect(ring.color).not.toBe(await canvasColor(page))
      expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
      if (selector === '.dts-checkbox__input') {
        // Our rule picks Highlight explicitly.
        expect(ring.color).toBe(await systemColor(page, 'Highlight'))
      }
    })
  }
}
