import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, type ButtonSize, type ButtonVariant } from './Button'

const VARIANTS: ButtonVariant[] = ['primary', 'secondary']
const SIZES: ButtonSize[] = ['sm', 'md']

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Button' },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
    size: { control: 'inline-radio', options: SIZES },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Small: Story = { args: { size: 'sm' } }

export const Disabled: Story = { args: { disabled: true } }

/** Every variant, size and enabled/disabled combination. Switch themes in the toolbar. */
export const All: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {[false, true].map((disabled) =>
        VARIANTS.map((variant) => (
          <div
            key={`${variant}-${disabled}`}
            style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}
          >
            {SIZES.map((size) => (
              <Button
                key={size}
                variant={variant}
                size={size}
                disabled={disabled}
              >
                {variant} {size}
                {disabled ? ' disabled' : ''}
              </Button>
            ))}
          </div>
        )),
      )}
    </div>
  ),
}
