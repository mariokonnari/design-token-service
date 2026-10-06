import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Alert, type AlertVariant } from './Alert'

// axe in jsdom checks structure only; it cannot evaluate color-contrast. The
// role mapping tested here is what decides how assistive technology treats the
// alert, but whether an announcement is actually spoken depends on the screen
// reader and on when the alert is mounted (see the comment in Alert.tsx).

const VARIANTS: [AlertVariant, string, string][] = [
  ['info', 'status', 'Information: '],
  ['success', 'status', 'Success: '],
  ['warning', 'status', 'Warning: '],
  ['danger', 'alert', 'Error: '],
]

describe('Alert', () => {
  it('defaults to the info variant', () => {
    render(<Alert>Heads up</Alert>)
    const region = screen.getByRole('status')
    expect(region.getAttribute('data-variant')).toBe('info')
  })

  it.each(VARIANTS)('%s uses role="%s"', (variant, role) => {
    render(<Alert variant={variant}>Message</Alert>)
    expect(screen.getByRole(role).getAttribute('data-variant')).toBe(variant)
  })

  it.each(VARIANTS)(
    '%s has the hidden prefix %j so meaning never depends on color',
    (variant, role, prefix) => {
      render(<Alert variant={variant}>Message</Alert>)
      const region = screen.getByRole(role)
      const hidden = region.querySelector('.dts-visually-hidden')
      expect(hidden?.textContent).toBe(prefix)
      expect(region.textContent).toBe(`${prefix}Message`)
    },
  )

  it.each(VARIANTS)('%s has a decorative aria-hidden icon', (variant, role) => {
    render(<Alert variant={variant}>Message</Alert>)
    const icon = screen.getByRole(role).querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('focusable')).toBe('false')
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('draws a different icon for each variant', () => {
    const shapes = VARIANTS.map(([variant]) => {
      const { container, unmount } = render(
        <Alert variant={variant}>Message</Alert>,
      )
      const html = container.querySelector('svg')?.innerHTML
      unmount()
      return html
    })
    expect(new Set(shapes).size).toBe(4)
  })

  it('renders an optional title with the prefix once, then the children', () => {
    render(
      <Alert variant="warning" title="Disk almost full">
        <p>Free some space.</p>
      </Alert>,
    )
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('Warning: Disk almost fullFree some space.')
    expect(region.querySelectorAll('.dts-visually-hidden')).toHaveLength(1)
    expect(screen.getByText('Disk almost full').className).toContain(
      'dts-alert__title',
    )
  })

  it('renders without a title', () => {
    render(<Alert>Plain message</Alert>)
    expect(document.querySelector('.dts-alert__title')).toBeNull()
    expect(screen.getByText('Plain message')).toBeTruthy()
  })

  it('lets the prefix be overridden per instance (no built-in English-only text)', () => {
    render(
      <Alert variant="danger" labelPrefix="Fehler: ">
        Gespeichert nicht möglich
      </Alert>,
    )
    const region = screen.getByRole('alert')
    expect(region.textContent).toBe('Fehler: Gespeichert nicht möglich')
    expect(region.textContent).not.toContain('Error:')
  })

  it('lets the prefix be overridden together with a title', () => {
    render(
      <Alert variant="success" title="Fertig" labelPrefix="Erfolg: ">
        ok
      </Alert>,
    )
    expect(screen.getByRole('status').textContent).toBe('Erfolg: Fertigok')
  })

  it('can drop the prefix with an empty string', () => {
    render(
      <Alert labelPrefix="" title="T">
        body
      </Alert>,
    )
    expect(screen.getByRole('status').textContent).toBe('Tbody')
  })

  it('allows the role to be overridden by the caller', () => {
    render(
      <Alert variant="info" role="alert">
        Urgent
      </Alert>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('passes div props through and forwards ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Alert ref={ref} id="a1" className="extra" data-testid="alert">
        Message
      </Alert>,
    )
    const element = screen.getByTestId('alert')
    expect(ref.current).toBe(element)
    expect(element.id).toBe('a1')
    expect(element.className).toBe('dts-alert extra')
  })

  it('keeps announcements working when content is added after mount (live region)', () => {
    const { rerender } = render(<Alert variant="danger" />)
    const region = screen.getByRole('alert')
    expect(region.textContent).toBe('Error: ')
    rerender(<Alert variant="danger">Now it has text</Alert>)
    expect(screen.getByRole('alert')).toBe(region)
    expect(region.textContent).toBe('Error: Now it has text')
  })
})

describe('Alert accessibility (jsdom + axe, structure only)', () => {
  const states: [string, React.ReactElement][] = VARIANTS.flatMap(
    ([variant]) => [
      [
        `${variant}`,
        <Alert key={`${variant}-1`} variant={variant}>
          Something happened.
        </Alert>,
      ] as [string, React.ReactElement],
      [
        `${variant} with title`,
        <Alert key={`${variant}-2`} variant={variant} title="Title">
          <p>Details.</p>
        </Alert>,
      ] as [string, React.ReactElement],
    ],
  )

  it.each(states)('has no axe violations: %s', async (_name, element) => {
    const { container } = render(element)
    expect(await axe(container)).toHaveNoViolations()
  })
})
