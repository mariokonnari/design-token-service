import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../.storybook/themes'
import { loadThemeSources } from '../scripts/lib/buildThemes'

const root = join(import.meta.dirname, '..')

describe('Storybook configuration', () => {
  it('offers exactly the themes that exist as token files', () => {
    expect([...THEMES].sort()).toEqual(
      loadThemeSources()
        .map((source) => source.slug)
        .sort(),
    )
  })

  it('loads the generated theme CSS and the a11y addon', () => {
    const preview = readFileSync(
      join(root, '.storybook', 'preview.tsx'),
      'utf8',
    )
    expect(preview).toContain("import '../src/themes.generated.css'")
    expect(preview).toContain('ThemeScope')
    const main = readFileSync(join(root, '.storybook', 'main.ts'), 'utf8')
    expect(main).toContain('@storybook/addon-a11y')
  })

  it('has a story file for the Button covering every variant and size', () => {
    const stories = readFileSync(
      join(root, 'src', 'Button', 'Button.stories.tsx'),
      'utf8',
    )
    for (const name of ['Primary', 'Secondary', 'Small', 'Disabled', 'All']) {
      expect(stories).toMatch(new RegExp(`export const ${name}\\b`))
    }
    expect(stories).toContain("'primary', 'secondary'")
    expect(stories).toContain("'sm', 'md'")
  })

  it('exposes build scripts', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }
    expect(pkg.scripts['storybook']).toContain('storybook dev')
    expect(pkg.scripts['build-storybook']).toContain('storybook build')
  })
})
