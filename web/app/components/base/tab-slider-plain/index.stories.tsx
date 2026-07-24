import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import TabSliderPlain from '.'

const OPTIONS = [
  { value: 'analytics', text: 'Analytics' },
  { value: 'activity', text: 'Recent activity' },
  { value: 'alerts', text: 'Alerts' },
]

const TabSliderPlainDemo = ({
  initialValue = 'analytics',
}: {
  initialValue?: string
}) => {
  const [value, setValue] = useState(initialValue)

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Underline tabs</div>
      <TabSliderPlain
        value={value}
        onChange={setValue}
        options={OPTIONS}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Navigation/TabSliderPlain',
  component: TabSliderPlainDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Underline-style navigation commonly used in dashboards. Toggle between three sections.',
      },
    },
  },
  argTypes: {
    initialValue: {
      control: 'radio',
      options: OPTIONS.map(option => option.value),
    },
  },
  args: {
    initialValue: 'analytics',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TabSliderPlainDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
