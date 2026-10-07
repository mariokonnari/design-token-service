import { expect, test, type Locator, type Page } from '@playwright/test'
import { describeViolations, runAxe } from './support/axe'
import { openStory, THEMES } from './support/stories'

// The native <dialog> provides the top layer, the inert background, the focus
// trap, Esc and focus restoration. jsdom cannot, so this suite is where they are
// verified (ADR 0011). Chromium only.

const CLOSED = 'components-dialog--closed-with-trigger'
const OPEN = 'components-dialog--open-by-default'
const LONG = 'components-dialog--long-content'
const CUSTOM = 'components-dialog--custom-close-label'

const trigger = (page: Page) =>
  page.getByRole('button', { name: 'Open dialog' })
const dialog = (page: Page) => page.locator('dialog.dts-dialog')
const closeButton = (page: Page) =>
  dialog(page).getByRole('button', { name: 'Close' })

const isOpen = (page: Page) =>
  dialog(page).evaluate((el) => (el as HTMLDialogElement).open)

/** The element that has focus: its tag/role/text, and whether it is inside the dialog. */
async function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement
    const dlg = document.querySelector('dialog.dts-dialog')
    return {
      tag: el?.tagName.toLowerCase() ?? null,
      text: (el?.textContent ?? '').trim(),
      label: el?.getAttribute('aria-label') ?? null,
      insideDialog: Boolean(dlg && el && dlg.contains(el)),
      isBody: el === document.body,
    }
  })
}

/** A point on the backdrop: the dialog is centered, so the top-left corner is outside it. */
const BACKDROP = { x: 4, y: 4 }

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function openByClick(page: Page) {
  await trigger(page).click()
  await expect(dialog(page)).toBeVisible()
  expect(await isOpen(page)).toBe(true)
}

/** Reaches the trigger with the keyboard only and presses Enter. */
async function openByKeyboard(page: Page) {
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab')
    if ((await activeElement(page)).text === 'Open dialog') break
  }
  expect((await activeElement(page)).text).toBe('Open dialog')
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
}

async function expectReopens(page: Page) {
  // If React state and the native dialog ever disagree, this fails.
  await expect(dialog(page)).toBeHidden()
  await openByClick(page)
}

for (const theme of THEMES) {
  test.describe(`Dialog in a real browser [${theme}]`, () => {
    test('has role dialog and an accessible name equal to its title, with a real heading', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const named = page.getByRole('dialog', { name: 'Edit profile' })
      await expect(named).toBeVisible()
      await expect(
        named.getByRole('heading', { level: 2, name: 'Edit profile' }),
      ).toBeVisible()
      const modal = await dialog(page).evaluate((el) => el.matches(':modal'))
      expect(modal, 'opened with showModal()').toBe(true)
    })

    test('opening moves focus inside the dialog', async ({ page }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const focus = await activeElement(page)
      expect(focus.insideDialog, JSON.stringify(focus)).toBe(true)
    })

    test('opened by keyboard, the focused control shows a focus ring', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByKeyboard(page)
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const s = getComputedStyle(el)
        return {
          insideDialog: Boolean(el.closest('dialog.dts-dialog')),
          focusVisible: el.matches(':focus-visible'),
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
          color: s.outlineColor,
        }
      })
      expect(ring.insideDialog).toBe(true)
      expect(ring.focusVisible).toBe(true)
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
    })

    // NATIVE BEHAVIOR, chosen deliberately (ADR 0011): we use <dialog>.showModal()
    // and add no focus trap of our own. In Chromium a modal dialog's Tab order is
    // its own controls PLUS ONE STOP ON THE BROWSER UI, then back inside. Headless
    // Chromium has no browser UI, so that extra stop is reported as document.body.
    // So the guarantee we can test is: the page BEHIND the dialog never receives
    // focus (it is inert), the only stop outside the dialog is the document/browser
    // UI, there is never more than one such stop in a row, and focus comes back.
    for (const [key, label] of [
      ['Tab', 'forward'],
      ['Shift+Tab', 'backward'],
    ] as const) {
      test(`${label}: only the dialog or the browser UI ever has focus, never two stops outside in a row, and focus comes back within one press`, async ({
        page,
      }) => {
        await openStory(page, CLOSED, theme)
        await openByClick(page)

        const PRESSES = 14
        const stops: Awaited<ReturnType<typeof activeElement>>[] = []
        for (let i = 0; i < PRESSES; i++) {
          await page.keyboard.press(key)
          stops.push(await activeElement(page))
        }
        const trace = stops
          .map((s) => (s.isBody ? 'body' : (s.label ?? s.text)))
          .join(' > ')

        // 1. Nothing outside the dialog except document.body ever has focus.
        //    In particular the trigger and the background button never appear.
        stops.forEach((s, i) => {
          expect(
            s.insideDialog || s.isBody,
            `${key} #${i + 1} reached something outside the dialog: ${JSON.stringify(s)}\n${trace}`,
          ).toBe(true)
          expect(['Open dialog', 'Background button']).not.toContain(s.text)
        })

        // 2. Never two consecutive stops outside the dialog.
        // 3. After a body stop, focus is back inside within one press.
        stops.forEach((s, i) => {
          const next = stops[i + 1]
          if (!s.isBody || next === undefined) return
          expect(
            next.insideDialog,
            `${key}: after the body stop at #${i + 1}, press #${i + 2} is not inside the dialog\n${trace}`,
          ).toBe(true)
        })

        // Not vacuous: both controls were visited, the loop ran for the whole count.
        expect(stops).toHaveLength(PRESSES)
        const names = new Set(
          stops.filter((s) => s.insideDialog).map((s) => s.label ?? s.text),
        )
        expect([...names].sort()).toEqual(['Close', 'Save'])
      })
    }
    test('the background is inert: it cannot be focused or clicked', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const background = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(
          (b) => !b.closest('dialog'),
        )
        return buttons.map((b) => {
          b.focus()
          const r = b.getBoundingClientRect()
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          )
          return {
            text: b.textContent,
            gotFocus: document.activeElement === b,
            // What a click at its position would reach.
            hitIsDialog: hit?.tagName.toLowerCase() === 'dialog',
            hitIsSelf: hit === b,
          }
        })
      })
      expect(background.length).toBeGreaterThan(1)
      for (const b of background) {
        expect(b.gotFocus, `${b.text} must not take focus`).toBe(false)
        expect(b.hitIsSelf, `${b.text} must not be hit by a click`).toBe(false)
        expect(
          b.hitIsDialog,
          `${b.text}: the click lands on the backdrop`,
        ).toBe(true)
      }
      await expect(
        trigger(page).click({ trial: true, timeout: 1500 }),
      ).rejects.toThrow()
    })

    test('Esc closes, focus returns to the trigger and it can be reopened (opened by mouse)', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
      expect((await activeElement(page)).text).toBe('Open dialog')
      await expectReopens(page)
    })

    test('Esc closes and returns focus to the trigger (opened by keyboard)', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByKeyboard(page)
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
      expect((await activeElement(page)).text).toBe('Open dialog')
      await page.keyboard.press('Enter') // the trigger really has focus
      await expect(dialog(page)).toBeVisible()
    })

    test('clicking the backdrop closes, and it can be reopened', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      await page.mouse.click(BACKDROP.x, BACKDROP.y)
      await expect(dialog(page)).toBeHidden()
      expect((await activeElement(page)).text).toBe('Open dialog')
      await expectReopens(page)
    })

    test('a press inside that is released on the backdrop does NOT close (text selection drag)', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const inside = await centerOf(
        dialog(page).getByText('Update how your name appears'),
      )
      await page.mouse.move(inside.x, inside.y)
      await page.mouse.down()
      await page.mouse.move(BACKDROP.x, BACKDROP.y, { steps: 8 })
      await page.mouse.up()
      expect(await isOpen(page)).toBe(true)
      await expect(dialog(page)).toBeVisible()
    })

    test('a press on the backdrop that is released inside does NOT close', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const inside = await centerOf(
        dialog(page).getByText('Update how your name appears'),
      )
      await page.mouse.move(BACKDROP.x, BACKDROP.y)
      await page.mouse.down()
      await page.mouse.move(inside.x, inside.y, { steps: 8 })
      await page.mouse.up()
      expect(await isOpen(page)).toBe(true)
    })

    test('a plain click inside the dialog does not close it', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      await dialog(page).getByText('Update how your name appears').click()
      await dialog(page).getByRole('heading').click()
      expect(await isOpen(page)).toBe(true)
    })

    test('the close button closes, returns focus to the trigger and it can be reopened', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      await closeButton(page).click()
      await expect(dialog(page)).toBeHidden()
      expect((await activeElement(page)).text).toBe('Open dialog')
      await expectReopens(page)
    })

    test('the Save button inside the content closes it too', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      await dialog(page).getByRole('button', { name: 'Save' }).click()
      await expect(dialog(page)).toBeHidden()
      await expectReopens(page)
    })

    test('the ::backdrop is a visible overlay that differs from the page', async ({
      page,
    }, testInfo) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const info = await dialog(page).evaluate((el) => {
        const backdrop = getComputedStyle(el, '::backdrop')
        const page = getComputedStyle(document.body)
        return {
          backdropBackground: backdrop.backgroundColor,
          // Does ::backdrop inherit our custom properties in this browser?
          inheritedOverlay: backdrop
            .getPropertyValue('--semantic-color-overlay')
            .trim(),
          inheritedBackdropToken: backdrop
            .getPropertyValue('--component-dialog-backdrop')
            .trim(),
          scopeSurface: getComputedStyle(el.closest('[data-theme]') ?? el)
            .backgroundColor,
          bodyBackground: page.backgroundColor,
        }
      })
      testInfo.annotations.push({
        type: '::backdrop in Chromium',
        description: JSON.stringify(info),
      })
      expect(info.backdropBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(info.backdropBackground).not.toBe('transparent')
      expect(info.backdropBackground).not.toBe(info.scopeSurface)
      expect(info.backdropBackground).not.toBe(info.bodyBackground)
      // The alpha is real: neither fully transparent nor opaque.
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(info.backdropBackground)
      expect(alpha, info.backdropBackground).not.toBeNull()
      const value = Number(alpha?.[1])
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThan(1)
    })

    test('axe passes with the dialog open (opened by click)', async ({
      page,
    }) => {
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const results = await runAxe(page)
      expect(results.violations.length, describeViolations(results)).toBe(0)
      expect(
        results.incomplete.filter((r) => r.id === 'color-contrast'),
        'color-contrast must not be undecided',
      ).toHaveLength(0)
    })

    test('forced colors: the dialog border is still drawn and axe passes', async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      await openStory(page, CLOSED, theme)
      await openByClick(page)
      const look = await dialog(page).evaluate((el) => {
        const s = getComputedStyle(el)
        const probe = document.createElement('div')
        probe.style.color = 'CanvasText'
        document.body.append(probe)
        const canvasText = getComputedStyle(probe).color
        probe.remove()
        return {
          style: s.borderTopStyle,
          width: parseFloat(s.borderTopWidth),
          color: s.borderTopColor,
          canvasText,
        }
      })
      expect(look.style).not.toBe('none')
      expect(look.width).toBeGreaterThan(0)
      expect(look.color).toBe(look.canvasText)
      const results = await runAxe(page)
      expect(results.violations.length, describeViolations(results)).toBe(0)
    })

    test('long content scrolls inside the dialog, which stays within the viewport', async ({
      page,
    }) => {
      await openStory(page, LONG, theme)
      const metrics = await page.evaluate(() => {
        const dlg = document.querySelector('dialog.dts-dialog') as HTMLElement
        const inner = dlg.querySelector('.dts-dialog__inner') as HTMLElement
        const r = dlg.getBoundingClientRect()
        return {
          open: (dlg as HTMLDialogElement).open,
          scrolls: inner.scrollHeight > inner.clientHeight,
          top: r.top,
          bottom: r.bottom,
          viewport: window.innerHeight,
        }
      })
      expect(metrics.open).toBe(true)
      expect(metrics.scrolls, 'the content must really overflow').toBe(true)
      expect(metrics.top).toBeGreaterThanOrEqual(0)
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport)
    })

    test('a custom closeLabel names the close button', async ({ page }) => {
      await openStory(page, CUSTOM, theme)
      await expect(
        dialog(page).getByRole('button', { name: 'Schließen' }),
      ).toBeVisible()
      await expect(
        dialog(page).getByRole('button', { name: 'Close' }),
      ).toHaveCount(0)
    })

    test('a dialog that is open from the start closes with Esc within two presses', async ({
      page,
    }, testInfo) => {
      // Chromium may ask for Esc twice when the dialog was opened without any user
      // interaction (close-watcher anti-abuse). We record what it does; we do not prevent it.
      await openStory(page, OPEN, theme)
      expect(await isOpen(page)).toBe(true)
      let presses = 0
      while ((await isOpen(page)) && presses < 2) {
        await page.keyboard.press('Escape')
        presses += 1
        await page.waitForTimeout(100)
      }
      testInfo.annotations.push({
        type: 'Esc presses needed (open without user activation)',
        description: String(presses),
      })
      expect(await isOpen(page)).toBe(false)
    })
  })
}
