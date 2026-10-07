import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef, StrictMode, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installDialogDouble,
  type DialogDouble,
} from '../../test/support/dialogDouble'
import { Dialog } from './index'

// IMPORTANT: jsdom has no showModal()/close(), so these tests use a minimal
// double (test/support/dialogDouble.ts). They check props, ARIA wiring and
// state syncing. Focus trapping, the inert background, focus restoration,
// ::backdrop and Esc are native behaviour and are covered ONLY by the
// real-browser suite (packages/ui/e2e/dialog.spec.ts).

let double: DialogDouble
beforeEach(() => {
  double = installDialogDouble()
})
afterEach(() => {
  // Unmount first: the component's cleanup calls close(), which the double provides.
  cleanup()
  double.restore()
})

type Props = Partial<ComponentProps<typeof Dialog>>

function Example({ children, ...props }: Props) {
  return (
    <Dialog open title="Edit profile" onOpenChange={() => undefined} {...props}>
      {children ?? <p>Body text</p>}
    </Dialog>
  )
}

const getDialog = () => document.querySelector('dialog') as HTMLDialogElement

describe('Dialog: opening and closing', () => {
  it('stays closed and never calls showModal while open is false', () => {
    render(<Example open={false} />)
    expect(getDialog().hasAttribute('open')).toBe(false)
    expect(double.calls).not.toContain('showModal')
  })

  it('calls showModal when open is true', () => {
    render(<Example open />)
    expect(getDialog().hasAttribute('open')).toBe(true)
    expect(double.calls.filter((c) => c === 'showModal')).toHaveLength(1)
  })

  it('opens and closes when the prop changes, without reporting its own change', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Example open={false} onOpenChange={onOpenChange} />,
    )
    rerender(<Example open onOpenChange={onOpenChange} />)
    expect(getDialog().hasAttribute('open')).toBe(true)
    rerender(<Example open={false} onOpenChange={onOpenChange} />)
    expect(getDialog().hasAttribute('open')).toBe(false)
    await double.flush()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('reports onOpenChange(false) when the browser closes it (Esc)', async () => {
    const onOpenChange = vi.fn()
    render(<Example open onOpenChange={onOpenChange} />)
    double.pressEscape(getDialog())
    await double.flush()
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not preventDefault the cancel event, so Esc always closes', () => {
    render(<Example open />)
    const cancel = new Event('cancel', { cancelable: true })
    getDialog().dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(false)
  })

  it('survives StrictMode double effects: ends open and reports nothing', async () => {
    const onOpenChange = vi.fn()
    render(
      <StrictMode>
        <Example open onOpenChange={onOpenChange} />
      </StrictMode>,
    )
    await double.flush()
    expect(getDialog().hasAttribute('open')).toBe(true)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('still reports a real close under StrictMode', async () => {
    const onOpenChange = vi.fn()
    render(
      <StrictMode>
        <Example open onOpenChange={onOpenChange} />
      </StrictMode>,
    )
    await double.flush()
    double.pressEscape(getDialog())
    await double.flush()
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('closes the native dialog on unmount without reporting', async () => {
    const onOpenChange = vi.fn()
    const { unmount } = render(<Example open onOpenChange={onOpenChange} />)
    const dialog = getDialog()
    unmount()
    expect(dialog.hasAttribute('open')).toBe(false)
    await double.flush()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('Dialog: ARIA wiring', () => {
  it('has role dialog named by its title through aria-labelledby', () => {
    render(<Example title="Edit profile" />)
    const dialog = screen.getByRole('dialog', { name: 'Edit profile' })
    const labelledBy = dialog.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(labelledBy)?.textContent).toBe(
      'Edit profile',
    )
  })

  it('renders the title as a real heading, h2 by default', () => {
    render(<Example />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Edit profile' }),
    ).toBeTruthy()
  })

  it.each([1, 3, 4, 6] as const)(
    'headingLevel %i renders that heading level',
    (level) => {
      render(<Example headingLevel={level} />)
      expect(
        screen.getByRole('heading', { level, name: 'Edit profile' }),
      ).toBeTruthy()
    },
  )

  it('links the description with aria-describedby and omits it without one', () => {
    const { rerender } = render(<Example description="Changes are saved." />)
    const dialog = getDialog()
    const describedBy = dialog.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Changes are saved.',
    )
    rerender(<Example />)
    expect(getDialog().hasAttribute('aria-describedby')).toBe(false)
  })

  it('gives two dialogs distinct ids', () => {
    render(
      <>
        <Example title="One" description="d1" />
        <Example title="Two" description="d2" />
      </>,
    )
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Dialog: the close button and built-in text', () => {
  it('names the close button "Close" by default', () => {
    render(<Example />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('uses a custom closeLabel and leaves no other built-in English text', () => {
    render(<Example closeLabel="Schließen" />)
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(getDialog().textContent).not.toMatch(/close/i)
    expect(getDialog().querySelector('[aria-label="Close"]')).toBeNull()
  })

  it('reports onOpenChange(false) when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('hides the icon from assistive technology', () => {
    render(<Example />)
    const svg = screen
      .getByRole('button', { name: 'Close' })
      .querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Dialog: backdrop clicks', () => {
  it('closes when pointer down and up both land on the dialog element', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.pointer([
      { keys: '[MouseLeft>]', target: getDialog() },
      { keys: '[/MouseLeft]', target: getDialog() },
    ])
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not close when closeOnBackdropClick is false', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} closeOnBackdropClick={false} />)
    await user.click(getDialog())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('does not close on a click inside the content', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.click(screen.getByText('Body text'))
    await user.click(screen.getByRole('heading'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('does not close when a drag starts inside and ends on the backdrop (text selection)', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByText('Body text') },
      { keys: '[/MouseLeft]', target: getDialog() },
    ])
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('does not close when a press starts on the backdrop and ends inside', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.pointer([
      { keys: '[MouseLeft>]', target: getDialog() },
      { keys: '[/MouseLeft]', target: screen.getByText('Body text') },
    ])
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('forgets an earlier press that never finished on the dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Example onOpenChange={onOpenChange} />)
    await user.pointer([
      { keys: '[MouseLeft>]', target: getDialog() },
      { keys: '[/MouseLeft]', target: screen.getByText('Body text') },
    ])
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByText('Body text') },
      { keys: '[/MouseLeft]', target: getDialog() },
    ])
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('Dialog: props and refs', () => {
  it('forwards the ref, appends className and passes other props, without leaking its own', () => {
    const ref = createRef<HTMLDialogElement>()
    render(
      <Example
        ref={ref}
        className="mine"
        data-testid="dlg"
        closeOnBackdropClick={false}
        headingLevel={3}
        closeLabel="Zu"
        description="d"
      />,
    )
    expect(ref.current).toBeInstanceOf(HTMLDialogElement)
    expect(ref.current?.className).toBe('dts-dialog mine')
    expect(ref.current?.getAttribute('data-testid')).toBe('dlg')
    const names = [...(ref.current?.attributes ?? [])].map((a) => a.name)
    for (const leaked of [
      'closeonbackdropclick',
      'headinglevel',
      'closelabel',
      'onopenchange',
      'title',
    ]) {
      expect(names).not.toContain(leaked)
    }
  })

  it('requires title and onOpenChange at the type level', () => {
    // @ts-expect-error title is required
    const missingTitle = <Dialog open onOpenChange={() => undefined} />
    // @ts-expect-error onOpenChange is required
    const missingHandler = <Dialog open title="x" />
    expect([missingTitle, missingHandler]).toHaveLength(2)
  })
})

describe('Dialog: axe', () => {
  it('has no violations when open, with a description', async () => {
    const { container } = render(<Example description="Changes are saved." />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no violations with a custom heading level and close label', async () => {
    const { container } = render(
      <Example headingLevel={3} closeLabel="Schließen" />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
