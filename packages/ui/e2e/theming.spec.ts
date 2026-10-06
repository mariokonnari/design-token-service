import { expect, test } from '@playwright/test'
import { openStory, THEMES, type Theme } from './support/stories'

const PRIMARY_BUTTON = 'components-button--primary'

async function primaryBackground(
  page: Parameters<typeof openStory>[0],
  theme: Theme,
): Promise<string> {
  await openStory(page, PRIMARY_BUTTON, theme) // also asserts data-theme === theme
  return page
    .locator('.dts-button[data-variant="primary"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
}

test('the primary Button is colored differently in each theme', async ({
  page,
}) => {
  const colors = new Map<Theme, string>()
  for (const theme of THEMES) {
    colors.set(theme, await primaryBackground(page, theme))
  }
  const [first, ...rest] = THEMES
  for (const theme of rest) {
    expect(
      colors.get(theme),
      `${theme} must not render the same primary background as ${first}`,
    ).not.toBe(colors.get(first))
  }
  // A transparent or unset color would make "differs" meaningless.
  for (const color of colors.values()) {
    expect(color).not.toBe('rgba(0, 0, 0, 0)')
  }
})
