import { describe, expect, it } from 'vitest'
import { cssVarName } from './cssVarName'

describe('cssVarName', () => {
  it('maps a dotted token path to a CSS custom property name', () => {
    expect(cssVarName('color.blue.500')).toBe('--color-blue-500')
  })
})
