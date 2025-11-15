import type { Meta, StoryObj } from '@storybook/nextjs'
import { RiLineChartLine, RiListCheck2, RiRobot2Line } from '@remixicon/react'
import { useState } from 'react'
import { SegmentedControl } from '.'

const SEGMENTS = [
  { value: 'overview', text: 'Overview', Icon: RiLineChartLine },
  { value: 'tasks', text: 'Tasks', Icon: RiListCheck2, count: 8 },
  { value: 'agents', text: 'Agents', Icon: RiRobot2Line },
]

const SegmentedControlDemo = ({
  initialValue = 'overview',
  size = 'regular',
  padding = 'with',
  activeState = 'default',
}: {
  initialValue?: string
  size?: 'regular' | 'small' | 'large'
  padding?: 'none' | 'with'
  activeState?: 'default' | 'accent' | 'accentLight'
}) => {
  const [value, setValue] = useState(initialValue)

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Segmented control</span>
        <code className="rounded-md bg-background-default px-2 py-1 text-[11px] text-text-tertiary">
          value="{value}"
        </code>
      </div>
      <SegmentedControl
        options={SEGMENTS}
        value={value}
        onChange={setValue}
        size={size}
        padding={padding}
        activeState={activeState}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Data Entry/SegmentedControl',
  component: SegmentedControlDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Multi-tab segmented control with optional icons and badge counts. Adjust sizing and accent states via controls.',
      },
    },
  },
  argTypes: {
    initialValue: {
      control: 'radio',
      options: SEGMENTS.map(segment => segment.value),
    },
    size: {
      control: 'inline-radio',
      options: ['small', 'regular', 'large'],
    },
    padding: {
      control: 'inline-radio',
      options: ['none', 'with'],
    },
    activeState: {
      control: 'inline-radio',
      options: ['default', 'accent', 'accentLight'],
    },
  },
  args: {
    initialValue: 'overview',
    size: 'regular',
    padding: 'with',
    activeState: 'default',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SegmentedControlDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const AccentState: Story = {
  args: {
    activeState: 'accent',
  },
}
