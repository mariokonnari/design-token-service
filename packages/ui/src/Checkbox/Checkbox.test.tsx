import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'

// axe in jsdom checks structure only (names, ARIA, ids); it cannot evaluate
// color-contrast, focus visibility or target size, and jsdom has no layout.

function ControlledCheckbox({
  onChange,
}: {
  onChange?: (checked: boolean) => void
}) {
  const [checked, setChecked] = useState(false)
  return (
    <Checkbox
      label="Subscribe"
      checked={checked}
      onChange={(event) => {
        setChecked(event.target.checked)
        onChange?.(event.target.checked)
      }}
    />
  )
}

describe('Checkbox', () => {
  it('is a native checkbox named by its label', () => {
    render(<Checkbox label="Subscribe" />)
    const input = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Subscribe',
    })
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('checkbox')
    expect(input.closest('label')?.textContent).toContain('Subscribe')
  })

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required.
    const element = <Checkbox />
    expect(element).toBeTruthy()
  })

  it('toggles when its label is clicked', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Subscribe" />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    await user.click(screen.getByText('Subscribe'))
    expect(input.checked).toBe(true)
    await user.click(screen.getByText('Subscribe'))
    expect(input.checked).toBe(false)
  })

  it('toggles with the Space key when focused', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Subscribe" />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    await user.tab()
    expect(document.activeElement).toBe(input)
    await user.keyboard(' ')
    expect(input.checked).toBe(true)
    await user.keyboard(' ')
    expect(input.checked).toBe(false)
  })

  it('works uncontrolled with defaultChecked', () => {
    render(<Checkbox label="Subscribe" defaultChecked />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  })

  it('works controlled and reports the new value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledCheckbox onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox label="Subscribe" disabled onChange={onChange} />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    expect(input.disabled).toBe(true)
    await user.click(screen.getByText('Subscribe'))
    await user.keyboard(' ')
    expect(input.checked).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wires an optional description through aria-describedby, outside the label', () => {
    render(<Checkbox label="Subscribe" description="Weekly, no spam." />)
    const input = screen.getByRole('checkbox', { name: 'Subscribe' })
    const description = document.getElementById(
      input.getAttribute('aria-describedby') ?? '',
    )
    expect(description?.textContent).toBe('Weekly, no spam.')
    expect(input.closest('label')?.contains(description)).toBe(false)
  })

  it('has no aria-describedby without a description', () => {
    render(<Checkbox label="Subscribe" />)
    expect(screen.getByRole('checkbox').hasAttribute('aria-describedby')).toBe(
      false,
    )
  })

  it('gives every instance its own id', () => {
    render(
      <>
        <Checkbox label="A" description="a" />
        <Checkbox label="B" description="b" />
      </>,
    )
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('forwards ref to the input and passes native props through', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <Checkbox
        label="Subscribe"
        ref={ref}
        name="news"
        value="yes"
        className="extra"
        data-testid="box"
      />,
    )
    const input = screen.getByTestId('box')
    expect(ref.current).toBe(input)
    expect(input.getAttribute('name')).toBe('news')
    expect(input.className).toContain('extra')
  })
})

describe('Checkbox: indeterminate (a DOM property, not an attribute)', () => {
  it('sets the property from the prop', () => {
    render(<Checkbox label="All" indeterminate />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    expect(input.indeterminate).toBe(true)
    expect(input.hasAttribute('indeterminate')).toBe(false)
  })

  it('is not indeterminate by default', () => {
    render(<Checkbox label="All" />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').indeterminate).toBe(
      false,
    )
  })

  it('follows the prop when it changes', () => {
    const { rerender } = render(<Checkbox label="All" indeterminate />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    rerender(<Checkbox label="All" indeterminate={false} />)
    expect(input.indeterminate).toBe(false)
    rerender(<Checkbox label="All" indeterminate />)
    expect(input.indeterminate).toBe(true)
  })

  it('is cleared by a click (native behavior) and onChange fires so the parent can update', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox label="All" indeterminate onChange={onChange} />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    await user.click(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(input.indeterminate).toBe(false)
  })

  it('is applied again on re-render while the parent keeps the prop true (the prop is authoritative)', async () => {
    const user = userEvent.setup()
    function Parent() {
      const [count, setCount] = useState(0)
      return (
        <>
          <Checkbox label="All" indeterminate />
          <button type="button" onClick={() => setCount(count + 1)}>
            rerender {count}
          </button>
        </>
      )
    }
    render(<Parent />)
    const input = screen.getByRole<HTMLInputElement>('checkbox')
    await user.click(input)
    expect(input.indeterminate).toBe(false)
    await user.click(screen.getByRole('button'))
    expect(input.indeterminate).toBe(true)
  })

  it('still forwards the ref to the same element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox label="All" indeterminate ref={ref} />)
    expect(ref.current).toBe(screen.getByRole('checkbox'))
    expect(ref.current?.indeterminate).toBe(true)
  })

  it('works with a callback ref', () => {
    let seen: HTMLInputElement | null = null
    render(
      <Checkbox
        label="All"
        indeterminate
        ref={(node) => {
          seen = node
        }}
      />,
    )
    expect(seen).toBe(screen.getByRole('checkbox'))
  })
})

describe('Checkbox accessibility (jsdom + axe, structure only)', () => {
  const states: [string, React.ReactElement][] = [
    ['default', <Checkbox key="a" label="Subscribe" />],
    ['checked', <Checkbox key="b" label="Subscribe" defaultChecked />],
    ['indeterminate', <Checkbox key="c" label="Subscribe" indeterminate />],
    ['disabled', <Checkbox key="d" label="Subscribe" disabled />],
    [
      'disabled and checked',
      <Checkbox key="e" label="Subscribe" disabled defaultChecked />,
    ],
    [
      'with description',
      <Checkbox key="f" label="Subscribe" description="Weekly, no spam." />,
    ],
    ['required', <Checkbox key="g" label="Accept" required />],
  ]

  it.each(states)('has no axe violations: %s', async (_name, element) => {
    const { container } = render(element)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('the wiring can fail: a checkbox with no label is reported', async () => {
    const { container } = render(<input type="checkbox" />)
    const results = await axe(container)
    expect(results.violations.map((violation) => violation.id)).toContain(
      'label',
    )
  })
})
