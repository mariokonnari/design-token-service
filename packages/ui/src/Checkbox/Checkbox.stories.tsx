import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { label: 'Subscribe to the newsletter' },
  argTypes: {
    disabled: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Checked: Story = { args: { defaultChecked: true } }

export const Indeterminate: Story = { args: { indeterminate: true } }

export const WithDescription: Story = {
  args: { description: 'One email a week. Unsubscribe any time.' },
}

export const Disabled: Story = { args: { disabled: true } }

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
}

/** Every state side by side. Click the labels and Tab/Space through them; switch themes in the toolbar. */
export const All: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Indeterminate" indeterminate />
      <Checkbox
        label="With description"
        description="Helper text under the label."
      />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled and checked" disabled defaultChecked />
    </div>
  ),
}
