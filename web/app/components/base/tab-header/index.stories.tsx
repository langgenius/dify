import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ITabHeaderProps } from '.'
import { useState } from 'react'
import TabHeader from '.'

const items: ITabHeaderProps['items'] = [
  { id: 'overview', name: 'Overview' },
  { id: 'playground', name: 'Playground' },
  { id: 'changelog', name: 'Changelog', extra: <span className="ml-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-600">New</span> },
  { id: 'docs', name: 'Docs', isRight: true },
  { id: 'settings', name: 'Settings', isRight: true, disabled: true },
]

const TabHeaderDemo = ({
  initialTab = 'overview',
}: {
  initialTab?: string
}) => {
  const [activeTab, setActiveTab] = useState(initialTab)

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Tabs</span>
        <code className="rounded-md bg-background-default px-2 py-1 text-[11px] text-text-tertiary">
          active="
          {activeTab}
          "
        </code>
      </div>
      <TabHeader
        items={items}
        value={activeTab}
        onChange={setActiveTab}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Navigation/TabHeader',
  component: TabHeaderDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Two-sided header tabs with optional right-aligned actions. Disabled items illustrate read-only states.',
      },
    },
  },
  argTypes: {
    initialTab: {
      control: 'radio',
      options: items.map(item => item.id),
    },
  },
  args: {
    initialTab: 'overview',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TabHeaderDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
