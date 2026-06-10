import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { Item } from '.'
import { useState } from 'react'
import Chip from '.'

const ITEMS: Item[] = [
  { value: 'all', name: 'All items' },
  { value: 'active', name: 'Active' },
  { value: 'archived', name: 'Archived' },
  { value: 'draft', name: 'Drafts' },
]

const meta = {
  title: 'Base/Data Entry/Chip',
  component: Chip,
  parameters: {
    docs: {
      description: {
        component: 'Filter chip with dropdown panel and optional left icon. Commonly used for status pickers in toolbars.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    items: ITEMS,
    value: 'all',

    onSelect: () => {},

    onClear: () => {},
  },
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

const ChipDemo = (props: React.ComponentProps<typeof Chip>) => {
  const [selection, setSelection] = useState(props.value)

  return (
    <div className="flex flex-col gap-4">
      <Chip
        {...props}
        value={selection}
        onSelect={item => setSelection(item.value)}
        onClear={() => setSelection('all')}
      />
      <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-3 text-xs text-text-secondary">
        Current value:
        {' '}
        <span className="font-mono text-text-primary">{selection}</span>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: args => <ChipDemo {...args} />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [selection, setSelection] = useState('all')

<Chip
  items={items}
  value={selection}
  onSelect={item => setSelection(item.value)}
  onClear={() => setSelection('all')}
/>
        `.trim(),
      },
    },
  },
}

export const WithoutLeftIcon: Story = {
  args: {
    showLeftIcon: false,

    onSelect: () => {},

    onClear: () => {},
  },
  render: args => (
    <ChipDemo
      {...args}
      showLeftIcon={false}
    />
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Chip showLeftIcon={false} ... />
        `.trim(),
      },
    },
  },
}
