import { readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { label, loadStories, openStory, THEMES } from './support/stories'

const stories = loadStories()

// A stale storybook-static must not let the whole suite pass on old stories.
test('the built Storybook contains every component that has stories in src', () => {
  const srcDir = new URL('../src/', import.meta.url)
  const components = readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) =>
      readdirSync(new URL(`${name}/`, srcDir)).some((f) =>
        f.endsWith('.stories.tsx'),
      ),
    )
  const built = new Set(stories.map((s) => s.title))
  expect(components.length).toBeGreaterThan(0)
  for (const component of components) {
    expect(built, `no built stories for ${component}`).toContain(
      `Components/${component}`,
    )
  }
})

/**
 * The a11y addon runs its OWN axe after every story render unless the global
 * `a11y.manual` is true. That run races with ours (AxeBuilder drives the same page):
 * "Axe is already running" (ADR 0010). The URL builder turns the automatic run off,
 * and this test reads the global back from the preview, so a Storybook upgrade that
 * renames or ignores it fails here instead of silently reintroducing the race.
 * The value must be the boolean true: a bare `true` in the URL arrives as the string
 * "true", which the addon does not treat as manual.
 */
test('the addon automatic axe run is switched off for e2e (a11y.manual is the boolean true)', async ({
  page,
}) => {
  const story = stories[0]
  if (story === undefined) throw new Error('no stories in the built Storybook')
  for (const theme of THEMES) {
    await openStory(page, story.id, theme)
    const globals = await page.evaluate(() => {
      const preview = (
        window as unknown as {
          __STORYBOOK_PREVIEW__?: {
            storyStoreValue?: { userGlobals?: { get: () => unknown } }
          }
        }
      ).__STORYBOOK_PREVIEW__
      return preview?.storyStoreValue?.userGlobals?.get()
    })
    expect(
      globals,
      'could not read the Storybook globals: the preview API moved, update this test',
    ).toBeDefined()
    expect(
      (globals as { a11y?: { manual?: unknown } }).a11y?.manual,
      `a11y.manual is not the boolean true for theme "${theme}": the addon runs its own axe and races with ours`,
    ).toBe(true)
  }
})

for (const story of stories) {
  for (const theme of THEMES) {
    test(`renders with its theme: ${label(story, theme)}`, async ({ page }) => {
      await openStory(page, story.id, theme)
    })
  }
}
