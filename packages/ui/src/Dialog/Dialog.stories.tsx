import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState, type ComponentProps } from 'react'
import { Button } from '../Button'
import { Dialog } from './index'

type DemoProps = Partial<
  Omit<ComponentProps<typeof Dialog>, 'open' | 'onOpenChange'>
> & { initialOpen?: boolean }

/**
 * A page with a trigger and some background content, so the modal behavior
 * (inert background, focus trap, focus returning to the trigger) can be tried.
 */
function Demo({
  initialOpen = false,
  title = 'Edit profile',
  children,
  ...props
}: DemoProps) {
  const [open, setOpen] = useState(initialOpen)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div style={{ display: 'grid', gap: '1rem', justifyItems: 'start' }}>
      <h1 style={{ margin: 0 }}>Account</h1>
      <p style={{ margin: 0 }}>Background content behind the dialog.</p>
      <Button
        ref={trigger}
        onClick={() => {
          setOpen(true)
        }}
      >
        Open dialog
      </Button>
      <Button variant="secondary">Background button</Button>
      <Dialog {...props} open={open} onOpenChange={setOpen} title={title}>
        {children ?? (
          <div style={{ display: 'grid', gap: '1rem', justifyItems: 'start' }}>
            <p style={{ margin: 0 }}>
              Update how your name appears to other people.
            </p>
            <Button
              onClick={() => {
                setOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  )
}

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  // Required props; every story renders its own stateful Demo instead.
  args: { open: false, onOpenChange: () => undefined, title: 'Edit profile' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** Closed, with a trigger. Open it with the mouse or the keyboard; Esc, the close button and the backdrop close it. */
export const ClosedWithTrigger: Story = {
  render: () => <Demo />,
}

/** Open from the start (used by the accessibility checks). */
export const OpenByDefault: Story = {
  render: () => <Demo initialOpen />,
}

export const WithDescription: Story = {
  render: () => (
    <Demo
      initialOpen
      description="Changes are saved when you press Save and are visible to your team."
    />
  ),
}

/** The content is taller than the viewport, so the dialog scrolls inside. */
export const LongContent: Story = {
  render: () => (
    <Demo initialOpen title="Terms of service">
      {Array.from({ length: 30 }, (_, i) => (
        <p key={i}>
          Paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing
          elit, sed do eiusmod tempor incididunt ut labore et dolore magna
          aliqua.
        </p>
      ))}
    </Demo>
  ),
}

/** The library ships no translations: the close label is a prop. */
export const CustomCloseLabel: Story = {
  render: () => (
    <Demo initialOpen title="Profil bearbeiten" closeLabel="Schließen" />
  ),
}
