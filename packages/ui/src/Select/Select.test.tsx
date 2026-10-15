import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef, useState, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

// axe runs in jsdom, which has no layout and does not load our CSS, so it
// cannot evaluate color-contrast, focus visibility or target size here. It does
// check structure: labels, ARIA attributes and id references. Contrast is
// covered by the registry tests in packages/ui/test, the rest by the e2e suite.

const options = [
  <option key="a" value="color">
    Color
  </option>,
  <option key="b" value="dimension">
    Dimension
  </option>,
]

function Controlled() {
  const [value, setValue] = useState('color')
  return (
    <Select
      label="Type"
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
      }}
    >
      {options}
    </Select>
  )
}

describe('Select: label', () => {
  it('associates a real <label for> with the select', () => {
    render(<Select label="Type">{options}</Select>)
    const select = screen.getByRole('combobox', { name: 'Type' })
    const label = screen.getByText('Type').closest('label')
    expect(label?.tagName).toBe('LABEL')
    expect(label?.getAttribute('for')).toBe(select.id)
    expect(select.id).not.toBe('')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByLabelText('Type')).toBe(select)
  })

  it('focuses the select when the label is clicked', async () => {
    const user = userEvent.setup()
    render(<Select label="Type">{options}</Select>)
    await user.click(screen.getByText('Type'))
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })

  it('gives every instance its own ids', () => {
    render(
      <>
        <Select label="First" description="d1" error="e1">
          {options}
        </Select>
        <Select label="Second" description="d2" error="e2">
          {options}
        </Select>
      </>,
    )
    const [first, second] = screen.getAllByRole('combobox')
    expect(first?.id).not.toBe(second?.id)
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses a provided id instead of a generated one', () => {
    render(
      <Select label="Type" id="my-type">
        {options}
      </Select>,
    )
    expect(screen.getByRole('combobox').id).toBe('my-type')
    expect(screen.getByText('Type').closest('label')?.getAttribute('for')).toBe(
      'my-type',
    )
  })

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required.
    const element = <Select>{options}</Select>
    expect(element).toBeTruthy()
  })
})

describe('Select: value handling', () => {
  it('renders its options and works uncontrolled', async () => {
    const user = userEvent.setup()
    render(
      <Select label="Type" defaultValue="color">
        {options}
      </Select>,
    )
    const select = screen.getByRole<HTMLSelectElement>('combobox')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(select.value).toBe('color')
    await user.selectOptions(select, 'dimension')
    expect(select.value).toBe('dimension')
  })

  it('works controlled', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const select = screen.getByRole<HTMLSelectElement>('combobox')
    await user.selectOptions(select, 'Dimension')
    expect(select.value).toBe('dimension')
  })

  it('calls onChange for a selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Select label="Type" onChange={onChange}>
        {options}
      </Select>,
    )
    await user.selectOptions(screen.getByRole('combobox'), 'dimension')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('passes native props through to the select', () => {
    render(
      <Select label="Type" name="type" className="extra" data-testid="field">
        {options}
      </Select>,
    )
    const select = screen.getByTestId('field')
    expect(select.tagName).toBe('SELECT')
    expect(select.getAttribute('name')).toBe('type')
    expect(select.className).toContain('extra')
    expect(select.className).toContain('dts-select__control')
  })

  it('forwards ref to the select (React 19 ref as a prop)', () => {
    const ref = createRef<HTMLSelectElement>()
    render(
      <Select label="Type" ref={ref}>
        {options}
      </Select>,
    )
    expect(ref.current).toBe(screen.getByRole('combobox'))
  })

  it('is disabled with the native attribute and ignores selection', async () => {
    const user = userEvent.setup()
    render(
      <Select label="Type" disabled defaultValue="color">
        {options}
      </Select>,
    )
    const select = screen.getByRole<HTMLSelectElement>('combobox')
    expect(select.disabled).toBe(true)
    await user.selectOptions(select, 'dimension')
    expect(select.value).toBe('color')
  })
})

describe('Select: description and error wiring', () => {
  function describedBy(select: HTMLElement): HTMLElement[] {
    const ids = (select.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
    return ids.map((id) => {
      const element = document.getElementById(id)
      if (element === null)
        throw new Error(`aria-describedby id ${id} does not exist`)
      return element
    })
  }

  it('has no aria-describedby and no aria-invalid by default', () => {
    render(<Select label="Type">{options}</Select>)
    const select = screen.getByRole('combobox')
    expect(select.hasAttribute('aria-describedby')).toBe(false)
    expect(select.hasAttribute('aria-invalid')).toBe(false)
  })

  it('points aria-describedby at the description element', () => {
    render(
      <Select label="Type" description="What kind of value it holds.">
        {options}
      </Select>,
    )
    const [description] = describedBy(screen.getByRole('combobox'))
    expect(description?.textContent).toBe('What kind of value it holds.')
  })

  it('adds the error to aria-describedby and sets aria-invalid only while there is an error', () => {
    const { rerender } = render(
      <Select label="Type" description="Kind.">
        {options}
      </Select>,
    )
    const select = screen.getByRole('combobox')
    expect(describedBy(select)).toHaveLength(1)

    rerender(
      <Select label="Type" description="Kind." error="Pick a type.">
        {options}
      </Select>,
    )
    const withError = describedBy(screen.getByRole('combobox'))
    expect(withError).toHaveLength(2)
    expect(withError[1]?.textContent).toContain('Pick a type.')
    expect(select.getAttribute('aria-invalid')).toBe('true')

    rerender(
      <Select label="Type" description="Kind.">
        {options}
      </Select>,
    )
    expect(describedBy(select)).toHaveLength(1)
    expect(select.hasAttribute('aria-invalid')).toBe(false)
    expect(screen.queryByText('Pick a type.')).toBeNull()
  })

  it('keeps a caller-provided aria-describedby and appends its own', () => {
    render(
      <>
        <p id="external">Outside note</p>
        <Select label="Type" aria-describedby="external" error="Oops.">
          {options}
        </Select>
      </>,
    )
    const ids = (
      screen.getByRole('combobox').getAttribute('aria-describedby') ?? ''
    ).split(' ')
    expect(ids[0]).toBe('external')
    expect(ids).toHaveLength(2)
  })

  it('precedes the error with a visually hidden "Error: " and a decorative icon', () => {
    render(
      <Select label="Type" error="Pick a type.">
        {options}
      </Select>,
    )
    const error = document.getElementById(
      screen.getByRole('combobox').getAttribute('aria-describedby') ?? '',
    )
    const hidden = error?.querySelector('.dts-visually-hidden')
    expect(hidden?.textContent).toBe('Error: ')
    expect(error?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(error?.textContent).toBe('Error: Pick a type.')
  })

  it('lets the error prefix be overridden (no built-in English-only text)', () => {
    render(
      <Select label="Typ" error="Pflichtfeld." errorPrefix="Fehler: ">
        {options}
      </Select>,
    )
    const error = document.getElementById(
      screen.getByRole('combobox').getAttribute('aria-describedby') ?? '',
    )
    expect(error?.textContent).toBe('Fehler: Pflichtfeld.')
  })
})

describe('Select: required', () => {
  it('sets the native required attribute and shows a visible, aria-hidden hint', () => {
    render(
      <Select label="Type" required>
        {options}
      </Select>,
    )
    expect(screen.getByRole<HTMLSelectElement>('combobox').required).toBe(true)
    const hint = screen.getByText('(required)')
    expect(hint.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeTruthy()
  })

  it('shows no hint when not required, and lets the hint be overridden', () => {
    const { rerender } = render(<Select label="Type">{options}</Select>)
    expect(screen.queryByText('(required)')).toBeNull()
    rerender(
      <Select label="Typ" required requiredHint="(Pflichtfeld)">
        {options}
      </Select>,
    )
    expect(screen.getByText('(Pflichtfeld)')).toBeTruthy()
    expect(screen.queryByText('(required)')).toBeNull()
  })
})

describe('Select accessibility (jsdom + axe, structure only)', () => {
  const states: [string, ReactElement][] = [
    [
      'default',
      <Select key="a" label="Type">
        {options}
      </Select>,
    ],
    [
      'with description',
      <Select key="b" label="Type" description="Kind of value.">
        {options}
      </Select>,
    ],
    [
      'with error',
      <Select key="c" label="Type" error="Pick a type.">
        {options}
      </Select>,
    ],
    [
      'required',
      <Select key="d" label="Type" required>
        {options}
      </Select>,
    ],
    [
      'disabled',
      <Select key="e" label="Type" disabled>
        {options}
      </Select>,
    ],
  ]

  it.each(states)('has no axe violations: %s', async (_name, element) => {
    const { container } = render(element)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('the wiring can fail: a select with no label is reported', async () => {
    const { container } = render(<select>{options}</select>)
    const results = await axe(container)
    expect(results.violations.map((violation) => violation.id)).toContain(
      'select-name',
    )
  })
})
