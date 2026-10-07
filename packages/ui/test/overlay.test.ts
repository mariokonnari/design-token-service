import { describe, expect, it } from 'vitest'
import { buildThemes, loadThemeSources } from '../scripts/lib/buildThemes'

// The dialog backdrop is translucent (it uses the token `alpha` field). The
// contrast registry needs opaque colors, so the overlay is checked here instead.

const builds = buildThemes(loadThemeSources())

describe.each(builds)('the overlay in the $slug theme', ({ resolved, css }) => {
  const overlay = resolved.find((t) => t.path === 'semantic.color.overlay')
  const backdrop = resolved.find((t) => t.path === 'component.dialog.backdrop')

  it('is a color that is neither transparent nor opaque', () => {
    expect(overlay?.type).toBe('color')
    if (overlay?.type !== 'color') return
    const alpha = overlay.value.alpha
    expect(alpha).toBeDefined()
    expect(alpha ?? 0).toBeGreaterThan(0)
    expect(alpha ?? 1).toBeLessThan(1)
  })

  it('is what the dialog backdrop resolves to', () => {
    expect(backdrop?.type).toBe('color')
    expect(backdrop?.value).toEqual(overlay?.value)
  })

  it('is exported with its alpha channel', () => {
    expect(css).toMatch(/--semantic-color-overlay:\s*rgb\([^)]*\/\s*0?\.\d+\)/)
  })
})
