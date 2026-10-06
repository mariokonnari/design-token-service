import { expect, test } from '@playwright/test'
import { label, loadStories, openStory, THEMES } from './support/stories'

/** WCAG 2.2 SC 2.5.8 minimum, in CSS px. We require it outright (no spacing exception). */
const MIN = 24

const INTERACTIVE = [
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'a[href]',
  '[role=button]',
  '[role=tab]',
  '[role=checkbox]',
].join(', ')

interface Measured {
  description: string
  width: number
  height: number
  /** 'self', or 'label' when a checkbox/radio is measured through its label. */
  measuredVia: 'self' | 'label'
  ownWidth: number
  ownHeight: number
}

for (const story of loadStories()) {
  for (const theme of THEMES) {
    test(`interactive elements are at least ${MIN}x${MIN}px: ${label(story, theme)}`, async ({
      page,
    }) => {
      await openStory(page, story.id, theme)

      const measured = await page.evaluate(
        ({ selector }) => {
          const out: Measured[] = []
          const root = document.querySelector('#storybook-root')
          for (const el of root?.querySelectorAll<HTMLElement>(selector) ??
            []) {
            if (!el.checkVisibility()) continue
            const own = el.getBoundingClientRect()
            const isChoice =
              el instanceof HTMLInputElement &&
              (el.type === 'checkbox' || el.type === 'radio')
            // The real click target of a checkbox/radio is its label, if it has one.
            const label = isChoice ? el.closest('label') : null
            const box = (label ?? el).getBoundingClientRect()
            out.push({
              description: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`,
              width: box.width,
              height: box.height,
              measuredVia: label ? 'label' : 'self',
              ownWidth: own.width,
              ownHeight: own.height,
            })
          }
          return out
        },
        { selector: INTERACTIVE },
      )

      const isAlert = story.title === 'Components/Alert'
      if (isAlert) {
        expect(measured, 'Alert has no interactive elements').toHaveLength(0)
      } else {
        expect(
          measured.length,
          'no interactive element found: the test would be vacuous',
        ).toBeGreaterThan(0)
      }

      const tooSmall = measured.filter((m) => m.width < MIN || m.height < MIN)
      expect(
        tooSmall,
        tooSmall
          .map(
            (m) =>
              `${m.description} (${m.measuredVia}) is ${m.width}x${m.height}`,
          )
          .join('\n'),
      ).toEqual([])

      // Record the numbers so the report can quote them.
      for (const m of measured) {
        test.info().annotations.push({
          type: 'target',
          description: `${m.description} via ${m.measuredVia}: ${m.width}x${m.height} (own box ${m.ownWidth}x${m.ownHeight})`,
        })
      }
    })
  }
}
