import type { Meta, StoryObj } from '@storybook/react-vite'
import { Alert, type AlertVariant } from './Alert'

const VARIANTS: AlertVariant[] = ['info', 'success', 'warning', 'danger']

const meta = {
  title: 'Components/Alert',
  component: Alert,
  args: { children: 'Your changes were saved.' },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
  },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Info: Story = { args: { variant: 'info' } }

export const Success: Story = { args: { variant: 'success' } }

export const Warning: Story = { args: { variant: 'warning' } }

export const Danger: Story = {
  args: { variant: 'danger', children: 'We could not save your changes.' },
}

export const WithTitle: Story = {
  args: {
    variant: 'warning',
    title: 'Your trial ends soon',
    children: 'Add a payment method to keep your projects.',
  },
}

/** Every variant, with and without a title. Info, success and warning use role="status"; danger uses role="alert". */
export const All: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '32rem' }}>
      {VARIANTS.map((variant) => (
        <Alert key={variant} variant={variant}>
          A {variant} message without a title.
        </Alert>
      ))}
      {VARIANTS.map((variant) => (
        <Alert
          key={`${variant}-title`}
          variant={variant}
          title={`A ${variant} title`}
        >
          The body text goes here and may wrap onto several lines when the
          container is narrow.
        </Alert>
      ))}
    </div>
  ),
}
