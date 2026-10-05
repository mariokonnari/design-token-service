import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeScope, isValidThemeSlug } from './ThemeScope'

describe('ThemeScope', () => {
  it('renders a div with data-theme and its children', () => {
    render(
      <ThemeScope theme="acme">
        <p>content</p>
      </ThemeScope>,
    )
    const paragraph = screen.getByText('content')
    expect(paragraph.parentElement?.tagName).toBe('DIV')
    expect(paragraph.parentElement?.getAttribute('data-theme')).toBe('acme')
  })

  it('passes other div props through', () => {
    render(
      <ThemeScope theme="default" id="scope" className="x" data-testid="s" />,
    )
    const element = screen.getByTestId('s')
    expect(element.id).toBe('scope')
    expect(element.className).toBe('x')
  })

  it('does not let a data-theme prop override the validated theme', () => {
    const extra = { 'data-theme': 'evil' } as Record<string, string>
    render(<ThemeScope theme="acme" data-testid="s" {...extra} />)
    expect(screen.getByTestId('s').getAttribute('data-theme')).toBe('acme')
  })

  it.each([
    '',
    'Acme',
    'a b',
    'a_b',
    '-a',
    'a-',
    'a--b',
    'a"]{',
    '</style>',
    'é',
  ])('throws for the invalid theme %j instead of rendering it', (theme) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<ThemeScope theme={theme} />)).toThrow(/theme/i)
    spy.mockRestore()
  })
})

describe('isValidThemeSlug', () => {
  it.each(['default', 'acme', 'acme-dark', 'a1', '0'])('accepts %j', (slug) => {
    expect(isValidThemeSlug(slug)).toBe(true)
  })

  it.each(['', 'Default', 'a b', 'a.b'])('rejects %j', (slug) => {
    expect(isValidThemeSlug(slug)).toBe(false)
  })
})
