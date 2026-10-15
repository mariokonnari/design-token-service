import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select'

const typeOptions = [
  <option key="color" value="color">
    Color
  </option>,
  <option key="dimension" value="dimension">
    Dimension
  </option>,
  <option key="font-family" value="fontFamily">
    Font family
  </option>,
  <option key="font-weight" value="fontWeight">
    Font weight
  </option>,
  <option key="number" value="number">
    Number
  </option>,
]

const meta = {
  title: 'Components/Select',
  component: Select,
  args: { label: 'Token type', children: typeOptions },
  argTypes: {
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithDescription: Story = {
  args: { description: 'What kind of value the token holds.' },
}

export const WithError: Story = {
  args: {
    description: 'What kind of value the token holds.',
    error: 'Choose a token type.',
  },
}

export const Required: Story = { args: { required: true } }

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'dimension' },
}

export const LongOptionText: Story = {
  args: {
    label: 'Library component',
    defaultValue: 'long',
    children: [
      <option key="short" value="short">
        Button
      </option>,
      <option key="long" value="long">
        A deliberately long option label that is wider than the field so the
        control has to clip or wrap it without breaking the layout
      </option>,
    ],
  },
}

/** Every state side by side. Switch themes in the toolbar and Tab through the fields to see the focus ring. */
export const All: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '24rem' }}>
      <Select label="Default">{typeOptions}</Select>
      <Select label="With value" defaultValue="fontWeight">
        {typeOptions}
      </Select>
      <Select
        label="With description"
        description="Helper text sits under the label."
      >
        {typeOptions}
      </Select>
      <Select label="Required" required>
        {typeOptions}
      </Select>
      <Select label="Error" error="This field has a problem.">
        {typeOptions}
      </Select>
      <Select
        label="Everything"
        required
        description="Helper text sits under the label."
        error="This field has a problem."
      >
        {typeOptions}
      </Select>
      <Select label="Disabled" disabled defaultValue="number">
        {typeOptions}
      </Select>
    </div>
  ),
}
