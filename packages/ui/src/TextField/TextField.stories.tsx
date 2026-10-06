import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from './TextField'

const meta = {
  title: 'Components/TextField',
  component: TextField,
  args: { label: 'Email address' },
  argTypes: {
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
  },
} satisfies Meta<typeof TextField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithDescription: Story = {
  args: { description: 'We only use it to send your receipt.' },
}

export const WithError: Story = {
  args: {
    description: 'We only use it to send your receipt.',
    error: 'Enter an email address like name@example.com.',
    defaultValue: 'not-an-email',
  },
}

export const Required: Story = { args: { required: true } }

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'locked@example.com' },
}

export const WithPlaceholder: Story = {
  args: { placeholder: 'name@example.com' },
}

/** Every state side by side. Switch themes in the toolbar and Tab through the fields to see the focus ring. */
export const All: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '24rem' }}>
      <TextField label="Default" />
      <TextField label="With placeholder" placeholder="name@example.com" />
      <TextField label="With value" defaultValue="ada@example.com" />
      <TextField
        label="With description"
        description="Helper text sits under the label."
      />
      <TextField label="Required" required />
      <TextField label="Error" error="This field has a problem." />
      <TextField
        label="Everything"
        required
        description="Helper text sits under the label."
        error="This field has a problem."
        defaultValue="oops"
      />
      <TextField label="Disabled" disabled defaultValue="Cannot edit" />
    </div>
  ),
}
