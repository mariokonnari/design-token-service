import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { THEMES, type Theme } from '../../.storybook/themes'

export { THEMES, type Theme }

export interface StoryEntry {
  id: string
  title: string
  name: string
}

const indexPath = new URL('../../storybook-static/index.json', import.meta.url)

/** The stories of the BUILT Storybook. Throws a readable error if it is not built. */
export function loadStories(): StoryEntry[] {
  let raw: string
  try {
    raw = readFileSync(indexPath, 'utf8')
  } catch {
    throw new Error(
      'storybook-static/index.json not found. Run `pnpm --filter @dts/ui build-storybook` first (or use test:e2e:build).',
    )
  }
  const index = JSON.parse(raw) as {
    entries: Record<
      string,
      { id: string; type: string; title: string; name: string }
    >
  }
  const stories = Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map(({ id, title, name }) => ({ id, title, name }))
  if (stories.length === 0) {
    throw new Error('storybook-static/index.json contains no stories.')
  }
  return stories
}

/** Stories of one component, e.g. storiesOf('Button'). Matches the title `Components/Button`. */
export function storiesOf(component: string): StoryEntry[] {
  return loadStories().filter((s) => s.title === `Components/${component}`)
}

export function storyUrl(id: string, theme: Theme): string {
  return `iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`
}

/** Test title helper: `components-button--primary [acme]`. */
export function label(story: StoryEntry, theme: Theme): string {
  return `${story.id} [${theme}]`
}

/**
 * Fails unless the story was really rendered with the requested theme: the
 * ThemeScope element carries that data-theme AND the theme's CSS variables are
 * defined on it. Without this a broken toolbar global would silently test the
 * default theme twice.
 */
export async function assertThemeApplied(
  page: Page,
  theme: Theme,
): Promise<void> {
  const scope = page.locator('#storybook-root [data-theme]').first()
  await expect(scope).toHaveAttribute('data-theme', theme)
  const surface = await scope.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--semantic-color-surface').trim(),
  )
  expect(
    surface,
    `theme "${theme}" defines no --semantic-color-surface: its CSS is missing`,
  ).not.toBe('')
}

/** Opens a story in the preview iframe, waits for it to render and checks the theme. */
export async function openStory(
  page: Page,
  id: string,
  theme: Theme,
): Promise<void> {
  await page.goto(storyUrl(id, theme))
  await page
    .locator('body.sb-show-main, body.sb-show-errordisplay')
    .first()
    .waitFor()
  if ((await page.locator('body.sb-show-errordisplay').count()) > 0) {
    const message = await page.locator('#error-message').innerText()
    throw new Error(`Story ${id} failed to render: ${message}`)
  }
  await expect(page.locator('#storybook-root')).not.toBeEmpty()
  await page.evaluate(() => document.fonts.ready)
  await assertThemeApplied(page, theme)
}
