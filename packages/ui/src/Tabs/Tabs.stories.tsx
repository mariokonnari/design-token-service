import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { Tab, TabList, TabPanel, Tabs } from './index'

type DemoProps = Omit<ComponentProps<typeof Tabs>, 'children'> & {
  disableGamma?: boolean
}

function Demo({ disableGamma = false, ...props }: DemoProps) {
  return (
    <Tabs {...props}>
      <TabList aria-label="Account sections">
        <Tab value="profile">Profile</Tab>
        <Tab value="security">Security</Tab>
        <Tab value="billing" disabled={disableGamma}>
          Billing
        </Tab>
        <Tab value="notifications">Notifications</Tab>
      </TabList>
      <TabPanel value="profile">
        <p>Profile settings: name, email and avatar.</p>
      </TabPanel>
      <TabPanel value="security">
        <p>Security settings: password and two-factor authentication.</p>
      </TabPanel>
      <TabPanel value="billing">
        <p>Billing: plan, invoices and payment method.</p>
      </TabPanel>
      <TabPanel value="notifications">
        <p>Notifications: choose what we email you about.</p>
      </TabPanel>
    </Tabs>
  )
}

function ControlledDemo() {
  const [value, setValue] = useState('security')
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <Demo value={value} onValueChange={setValue} />
      <p>Selected value (owned by the parent): {value}</p>
    </div>
  )
}

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  argTypes: {
    activationMode: {
      control: 'inline-radio',
      options: ['automatic', 'manual'],
    },
    orientation: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
    },
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

/** Arrow keys move and select; Home/End jump; Tab moves into the panel. Switch themes in the toolbar. */
export const Default: Story = {
  render: (args) => <Demo {...args} defaultValue="profile" />,
}

export const Vertical: Story = {
  render: (args) => (
    <Demo {...args} defaultValue="profile" orientation="vertical" />
  ),
}

/** Arrow keys only move focus; press Enter or Space to select. */
export const ManualActivation: Story = {
  render: (args) => (
    <Demo {...args} defaultValue="profile" activationMode="manual" />
  ),
}

/** The disabled tab is skipped by the keyboard and cannot be selected. */
export const DisabledTab: Story = {
  render: (args) => <Demo {...args} defaultValue="profile" disableGamma />,
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}
