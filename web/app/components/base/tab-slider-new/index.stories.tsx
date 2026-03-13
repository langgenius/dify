import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { RiSparklingFill, RiTerminalBoxLine } from '@remixicon/react'
import { useState } from 'react'
import TabSliderNew from '.'

const OPTIONS = [
  { value: 'visual', text: 'Visual builder', icon: <RiSparklingFill className="mr-2 h-4 w-4 text-primary-500" /> },
  { value: 'code', text: 'Code', icon: <RiTerminalBoxLine className="mr-2 h-4 w-4 text-text-tertiary" /> },
]

const TabSliderNewDemo = ({
  initialValue = 'visual',
}: {
  initialValue?: string
}) => {
  const [value, setValue] = useState(initialValue)

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Pill tabs</div>
      <TabSliderNew value={value} options={OPTIONS} onChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'Base/Navigation/TabSliderNew',
  component: TabSliderNewDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Rounded pill tabs suited for switching between editors. Icons illustrate mixed text/icon options.',
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
    initialValue: 'visual',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TabSliderNewDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
