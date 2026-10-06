import { expect, test, type Page } from '@playwright/test'
import { label, loadStories, openStory, THEMES } from './support/stories'

interface Animated {
  path: string
  transition: string
  animation: string
}

/** Every element (and ::before/::after) in the story with a non-zero transition or animation duration. */
async function animatedElements(page: Page): Promise<Animated[]> {
  return page.evaluate(() => {
    const out: { path: string; transition: string; animation: string }[] = []
    const nonZero = (list: string) =>
      list.split(',').some((v) => parseFloat(v) !== 0)
    const root = document.querySelector('#storybook-root')
    if (!root) return out
    for (const el of root.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pseudo)
        if (nonZero(s.transitionDuration) || nonZero(s.animationDuration)) {
          // A stable path: tag.class:nth-position within the root.
          const index = Array.from(root.querySelectorAll('*')).indexOf(el)
          out.push({
            path: `${el.tagName.toLowerCase()}#${index}${pseudo ?? ''}`,
            transition: s.transitionDuration,
            animation: s.animationDuration,
          })
        }
      }
    }
    return out
  })
}

/** Components that declare a transition today; their stories must show motion in normal mode. */
const ANIMATED_COMPONENTS = new Set(['Components/Button'])

for (const story of loadStories()) {
  for (const theme of THEMES) {
    test(`reduced motion switches animations off: ${label(story, theme)}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await openStory(page, story.id, theme)
      const normal = await animatedElements(page)

      if (ANIMATED_COMPONENTS.has(story.title)) {
        // Not vacuous: motion must really exist to be switched off.
        expect(
          normal.length,
          'no animated element found in normal mode',
        ).toBeGreaterThan(0)
      }

      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(
        await page.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
      ).toBe(true)

      const reduced = await animatedElements(page)
      expect(
        reduced,
        `still animated with prefers-reduced-motion: reduce (were ${JSON.stringify(normal.map((n) => n.path))})`,
      ).toEqual([])
    })
  }
}
