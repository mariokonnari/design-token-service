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

for (const story of stories) {
  for (const theme of THEMES) {
    test(`renders with its theme: ${label(story, theme)}`, async ({ page }) => {
      await openStory(page, story.id, theme)
    })
  }
}
