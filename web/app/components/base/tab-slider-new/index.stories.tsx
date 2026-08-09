import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import TabSliderNew from '.'

const OPTIONS = [
  {
    value: 'visual',
    text: 'Visual builder',
    icon: <span className="mr-2 i-ri-sparkling-fill size-4 text-primary-500" aria-hidden="true" />,
  },
  {
    value: 'code',
    text: 'Code',
    icon: (
      <span className="mr-2 i-ri-terminal-box-line size-4 text-text-tertiary" aria-hidden="true" />
    ),
  },
]

const TabSliderNewDemo = ({ initialValue = 'visual' }: { initialValue?: string }) => {
  const [value, setValue] = useState(initialValue)

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs tracking-[0.18em] text-text-tertiary uppercase">Pill tabs</div>
      <TabSliderNew ariaLabel="Builder mode" value={value} options={OPTIONS} onChange={setValue} />
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
        component:
          'Rounded pill tabs suited for switching between editors. Icons illustrate mixed text/icon options.',
      },
    },
  },
  argTypes: {
    initialValue: {
      control: 'radio',
      options: OPTIONS.map((option) => option.value),
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
