import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(import.meta.dirname, '..', 'src')

const EXPECTED: Record<string, string[]> = {
  TextField: [
    'Default',
    'WithDescription',
    'WithError',
    'Required',
    'Disabled',
    'WithPlaceholder',
    'All',
  ],
  Checkbox: [
    'Default',
    'Checked',
    'Indeterminate',
    'WithDescription',
    'Disabled',
    'DisabledChecked',
    'All',
  ],
  Alert: ['Info', 'Success', 'Warning', 'Danger', 'WithTitle', 'All'],
  Dialog: [
    'ClosedWithTrigger',
    'OpenByDefault',
    'WithDescription',
    'LongContent',
    'CustomCloseLabel',
  ],
  Tabs: [
    'Default',
    'Vertical',
    'ManualActivation',
    'DisabledTab',
    'Controlled',
  ],
}

describe.each(Object.entries(EXPECTED))('%s stories', (name, stories) => {
  const source = readFileSync(join(src, name, `${name}.stories.tsx`), 'utf8')

  it.each(stories)('exports the %s story', (story) => {
    expect(source).toMatch(new RegExp(String.raw`export const ${story}\b`))
  })

  it('has a title under Components and uses the component itself', () => {
    expect(source).toContain(`title: 'Components/${name}'`)
    expect(source).toContain(`component: ${name}`)
  })
})
