import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button, type ButtonSize, type ButtonVariant } from './Button'

// About the axe checks below: they run in jsdom, which has no layout engine and
// does not load our CSS, so axe cannot evaluate `color-contrast` (or focus
// visibility, target size or forced-colors behaviour) here. They do catch
// structural problems such as a missing accessible name. Contrast is covered
// separately by the token contrast tests in packages/ui/test, and in a real
// browser by the Storybook a11y addon.

const VARIANTS: ButtonVariant[] = ['primary', 'secondary']
const SIZES: ButtonSize[] = ['sm', 'md']

describe('Button', () => {
  it('renders a native button with its label', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.classList.contains('dts-button')).toBe(true)
  })

  it('defaults to type="button" and keeps an explicit type', () => {
    const { rerender } = render(<Button>Go</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
    rerender(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit')
  })

  it('defaults to the primary variant and the md size', () => {
    render(<Button>Go</Button>)
    const button = screen.getByRole('button')
    expect(button.getAttribute('data-variant')).toBe('primary')
    expect(button.getAttribute('data-size')).toBe('md')
  })

  it.each(VARIANTS.flatMap((v) => SIZES.map((s): [string, string] => [v, s])))(
    'exposes variant %s and size %s as data attributes only',
    (variant, size) => {
      render(
        <Button variant={variant as ButtonVariant} size={size as ButtonSize}>
          Go
        </Button>,
      )
      const button = screen.getByRole('button')
      expect(button.getAttribute('data-variant')).toBe(variant)
      expect(button.getAttribute('data-size')).toBe(size)
      expect(button.hasAttribute('variant')).toBe(false)
      expect(button.hasAttribute('size')).toBe(false)
    },
  )

  it('keeps a custom className after its own class and passes native props', () => {
    render(
      <Button className="extra" id="b" title="hint" aria-describedby="d">
        Go
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button.className).toBe('dts-button extra')
    expect(button.id).toBe('b')
    expect(button.title).toBe('hint')
    expect(button.getAttribute('aria-describedby')).toBe('d')
  })

  it('calls onClick once per click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('activates with the Enter key', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('activates with the Space key', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.tab()
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses the real disabled attribute and cannot be clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    )
    const button = screen.getByRole<HTMLButtonElement>('button')
    expect(button.disabled).toBe(true)
    expect(button.hasAttribute('disabled')).toBe(true)
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cannot be reached or activated by keyboard when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    )
    await user.tab()
    expect(document.activeElement).not.toBe(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards ref as a regular prop (React 19)', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Go</Button>)
    expect(ref.current).toBe(screen.getByRole('button'))
  })
})

describe('Button accessibility (jsdom + axe, structure only)', () => {
  it.each(VARIANTS.flatMap((v) => SIZES.map((s): [string, string] => [v, s])))(
    'has no axe violations: variant %s, size %s',
    async (variant, size) => {
      const { container } = render(
        <Button variant={variant as ButtonVariant} size={size as ButtonSize}>
          Label
        </Button>,
      )
      expect(await axe(container)).toHaveNoViolations()
    },
  )

  it('has no axe violations when disabled', async () => {
    const { container } = render(<Button disabled>Label</Button>)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations for an icon-only button that has an aria-label', async () => {
    const { container } = render(
      <Button aria-label="Close">
        <svg aria-hidden="true" width="16" height="16" focusable="false">
          <path d="M0 0L16 16M16 0L0 16" stroke="currentColor" />
        </svg>
      </Button>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('the wiring can fail: an icon-only button with no accessible name is reported', async () => {
    const { container } = render(
      <Button>
        <svg aria-hidden="true" width="16" height="16" focusable="false">
          <path d="M0 0L16 16M16 0L0 16" stroke="currentColor" />
        </svg>
      </Button>,
    )
    const results = await axe(container)
    expect(results.violations.length).toBeGreaterThan(0)
    expect(results.violations.map((violation) => violation.id)).toContain(
      'button-name',
    )
    expect(() => expect(results).toHaveNoViolations()).toThrow()
  })
})
