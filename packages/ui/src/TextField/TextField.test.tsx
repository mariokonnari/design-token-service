import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from './TextField'

// axe runs in jsdom, which has no layout and does not load our CSS, so it
// cannot evaluate color-contrast, focus visibility or target size here. It does
// check structure: labels, ARIA attributes and id references. Contrast is
// covered by the registry tests in packages/ui/test.

function ControlledField() {
  const [value, setValue] = useState('')
  return (
    <TextField
      label="Name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

describe('TextField: label', () => {
  it('associates a real <label for> with the input', () => {
    render(<TextField label="Email" />)
    const input = screen.getByRole('textbox', { name: 'Email' })
    const label = screen.getByText('Email').closest('label')
    expect(label?.tagName).toBe('LABEL')
    expect(label?.getAttribute('for')).toBe(input.id)
    expect(input.id).not.toBe('')
    expect(screen.getByLabelText('Email')).toBe(input)
  })

  it('focuses the input when the label is clicked', async () => {
    const user = userEvent.setup()
    render(<TextField label="Email" />)
    await user.click(screen.getByText('Email'))
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  it('gives every instance its own id', () => {
    render(
      <>
        <TextField label="First" description="d1" error="e1" />
        <TextField label="Second" description="d2" error="e2" />
      </>,
    )
    const [first, second] = screen.getAllByRole('textbox')
    expect(first?.id).not.toBe(second?.id)
    expect(first?.getAttribute('aria-describedby')).not.toBe(
      second?.getAttribute('aria-describedby'),
    )
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses a provided id instead of a generated one', () => {
    render(<TextField label="Email" id="my-email" description="hint" />)
    const input = screen.getByRole('textbox')
    expect(input.id).toBe('my-email')
    expect(
      screen.getByText('Email').closest('label')?.getAttribute('for'),
    ).toBe('my-email')
  })

  it('requires a label at the type level', () => {
    // @ts-expect-error label is required: a placeholder is not a label.
    const element = <TextField placeholder="Email" />
    expect(element).toBeTruthy()
  })
})

describe('TextField: value handling', () => {
  it('works uncontrolled', async () => {
    const user = userEvent.setup()
    render(<TextField label="Name" defaultValue="Ada" />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.value).toBe('Ada')
    await user.type(input, ' Lovelace')
    expect(input.value).toBe('Ada Lovelace')
  })

  it('works controlled', async () => {
    const user = userEvent.setup()
    render(<ControlledField />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    await user.type(input, 'abc')
    expect(input.value).toBe('abc')
  })

  it('calls onChange for each keystroke', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextField label="Name" onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), 'hey')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('passes native props through to the input', () => {
    render(
      <TextField
        label="Email"
        type="email"
        name="email"
        placeholder="you@example.com"
        autoComplete="email"
        maxLength={40}
        className="extra"
        data-testid="field"
      />,
    )
    const input = screen.getByTestId('field')
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('type')).toBe('email')
    expect(input.getAttribute('name')).toBe('email')
    expect(input.getAttribute('placeholder')).toBe('you@example.com')
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(input.getAttribute('maxlength')).toBe('40')
    expect(input.className).toContain('extra')
    expect(input.className).toContain('dts-textfield__input')
  })

  it('defaults to type="text"', () => {
    render(<TextField label="Name" />)
    expect(screen.getByRole('textbox').getAttribute('type')).toBe('text')
  })

  it('forwards ref to the input (React 19 ref as a prop)', () => {
    const ref = createRef<HTMLInputElement>()
    render(<TextField label="Name" ref={ref} />)
    expect(ref.current).toBe(screen.getByRole('textbox'))
  })

  it('is disabled with the native attribute and ignores typing', async () => {
    const user = userEvent.setup()
    render(<TextField label="Name" disabled defaultValue="x" />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.disabled).toBe(true)
    await user.type(input, 'abc')
    expect(input.value).toBe('x')
  })
})

describe('TextField: description and error wiring', () => {
  function describedBy(input: HTMLElement): HTMLElement[] {
    const ids = (input.getAttribute('aria-describedby') ?? '')
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
    render(<TextField label="Name" />)
    const input = screen.getByRole('textbox')
    expect(input.hasAttribute('aria-describedby')).toBe(false)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
  })

  it('points aria-describedby at the description element', () => {
    render(<TextField label="Name" description="As on your passport." />)
    const [description] = describedBy(screen.getByRole('textbox'))
    expect(description?.textContent).toBe('As on your passport.')
  })

  it('adds the error to aria-describedby and sets aria-invalid only while there is an error', () => {
    const { rerender } = render(
      <TextField label="Name" description="As on your passport." />,
    )
    const input = screen.getByRole('textbox')
    expect(describedBy(input)).toHaveLength(1)

    rerender(
      <TextField
        label="Name"
        description="As on your passport."
        error="Required."
      />,
    )
    const withError = describedBy(screen.getByRole('textbox'))
    expect(withError).toHaveLength(2)
    expect(withError[0]?.textContent).toBe('As on your passport.')
    expect(withError[1]?.textContent).toContain('Required.')
    expect(input.getAttribute('aria-invalid')).toBe('true')

    rerender(<TextField label="Name" description="As on your passport." />)
    expect(describedBy(input)).toHaveLength(1)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(screen.queryByText('Required.')).toBeNull()
  })

  it('works with only an error', () => {
    render(<TextField label="Name" error="Too short." />)
    const input = screen.getByRole('textbox')
    expect(describedBy(input)).toHaveLength(1)
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps a caller-provided aria-describedby and appends its own', () => {
    render(
      <>
        <p id="external">Outside note</p>
        <TextField label="Name" aria-describedby="external" error="Oops." />
      </>,
    )
    const ids = (
      screen.getByRole('textbox').getAttribute('aria-describedby') ?? ''
    ).split(' ')
    expect(ids[0]).toBe('external')
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[1] ?? '')?.textContent).toContain(
      'Oops.',
    )
  })

  it('precedes the error with a visually hidden "Error: " and a decorative icon, so color is never the only signal', () => {
    render(<TextField label="Name" error="Required." />)
    const error = document.getElementById(
      screen.getByRole('textbox').getAttribute('aria-describedby') ?? '',
    )
    const hidden = error?.querySelector('.dts-visually-hidden')
    expect(hidden?.textContent).toBe('Error: ')
    expect(error?.firstElementChild).toBe(hidden)
    const icon = error?.querySelector('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(error?.textContent).toBe('Error: Required.')
  })

  it('lets the error prefix be overridden (no built-in English-only text)', () => {
    render(
      <TextField label="Name" error="Pflichtfeld." errorPrefix="Fehler: " />,
    )
    const error = document.getElementById(
      screen.getByRole('textbox').getAttribute('aria-describedby') ?? '',
    )
    expect(error?.textContent).toBe('Fehler: Pflichtfeld.')
    expect(screen.queryByText('Error:', { exact: false })).toBeNull()
  })
})

describe('TextField: required', () => {
  it('sets the native required attribute and shows a visible, aria-hidden hint', () => {
    render(<TextField label="Email" required />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.required).toBe(true)
    const hint = screen.getByText('(required)')
    expect(hint.getAttribute('aria-hidden')).toBe('true')
    expect(hint.closest('label')?.textContent).toContain('(required)')
  })

  it('keeps the hint out of the accessible name (the attribute already announces required)', () => {
    render(<TextField label="Email" required />)
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
  })

  it('shows no hint when the field is not required', () => {
    render(<TextField label="Email" />)
    expect(screen.queryByText('(required)')).toBeNull()
  })

  it('lets the hint text be overridden', () => {
    render(<TextField label="E-Mail" required requiredHint="(Pflichtfeld)" />)
    expect(screen.getByText('(Pflichtfeld)').getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(screen.queryByText('(required)')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'E-Mail' })).toBeTruthy()
  })
})

describe('TextField accessibility (jsdom + axe, structure only)', () => {
  const states: [string, React.ReactElement][] = [
    ['default', <TextField key="a" label="Email" />],
    ['with value', <TextField key="b" label="Email" defaultValue="a@b.c" />],
    [
      'with description',
      <TextField key="c" label="Email" description="We never share it." />,
    ],
    [
      'with error',
      <TextField key="d" label="Email" error="Enter a valid email." />,
    ],
    ['required', <TextField key="e" label="Email" required />],
    ['disabled', <TextField key="f" label="Email" disabled />],
    [
      'description + error + required',
      <TextField
        key="g"
        label="Email"
        description="We never share it."
        error="Enter a valid email."
        required
      />,
    ],
    [
      'with a placeholder as well as a label',
      <TextField key="h" label="Email" placeholder="you@example.com" />,
    ],
  ]

  it.each(states)('has no axe violations: %s', async (_name, element) => {
    const { container } = render(element)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('the wiring can fail: an input with no label is reported', async () => {
    const { container } = render(<input />)
    const results = await axe(container)
    expect(results.violations.map((violation) => violation.id)).toContain(
      'label',
    )
  })

  it('LIMIT: axe itself accepts a placeholder as an input name, so "label, not placeholder" is enforced by the required label prop, not by axe', async () => {
    const { container } = render(<input placeholder="Email" />)
    const results = await axe(container)
    expect(results.violations.map((violation) => violation.id)).not.toContain(
      'label',
    )
  })
})
