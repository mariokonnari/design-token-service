import { expect, test } from '@playwright/test'
import {
  describeViolations,
  evaluatedNodes,
  incompleteNodes,
  runAxe,
} from './support/axe'
import { label, loadStories, openStory, THEMES } from './support/stories'

/**
 * Stories in which every piece of text belongs to a disabled control. WCAG 1.4.3
 * exempts disabled controls and axe reports color-contrast as inapplicable there,
 * so "no contrast node was evaluated" is expected, not a vacuous pass.
 */
const ALL_TEXT_DISABLED = new Set([
  'components-button--disabled',
  'components-checkbox--disabled',
  'components-checkbox--disabled-checked',
  'components-textfield--disabled',
])

for (const story of loadStories()) {
  for (const theme of THEMES) {
    test(`no axe violations: ${label(story, theme)}`, async ({ page }) => {
      await openStory(page, story.id, theme)
      const results = await runAxe(page)

      expect(results.violations.length, describeViolations(results)).toBe(0)

      // Not vacuous: contrast must actually have been measured in a real browser.
      // "Incomplete" means axe could not decide, which would hide a failure.
      expect(
        incompleteNodes(results, 'color-contrast'),
        'axe could not decide color-contrast for some nodes',
      ).toBe(0)
      const evaluated = evaluatedNodes(results, 'color-contrast')
      if (ALL_TEXT_DISABLED.has(story.id)) {
        expect(evaluated).toBe(0)
      } else {
        expect(
          evaluated,
          'axe evaluated no color-contrast node in this story',
        ).toBeGreaterThan(0)
      }
      test.info().annotations.push({
        type: 'color-contrast nodes',
        description: String(evaluated),
      })
    })
  }
}
