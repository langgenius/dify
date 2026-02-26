import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { Item } from '.'
import { useState } from 'react'
import { fn } from 'storybook/test'
import Dropdown from '.'

const PRIMARY_ITEMS: Item[] = [
  { value: 'rename', text: 'Rename' },
  { value: 'duplicate', text: 'Duplicate' },
]

const SECONDARY_ITEMS: Item[] = [
  { value: 'archive', text: <span className="text-text-destructive">Archive</span> },
  { value: 'delete', text: <span className="text-text-destructive">Delete</span> },
]

const meta = {
  title: 'Base/Navigation/Dropdown',
  component: Dropdown,
  parameters: {
    docs: {
      description: {
        component: 'Small contextual menu with optional destructive section. Uses portal positioning utilities for precise placement.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    items: PRIMARY_ITEMS,
    secondItems: SECONDARY_ITEMS,
  },
} satisfies Meta<typeof Dropdown>

export default meta
type Story = StoryObj<typeof meta>

const DropdownDemo = (props: React.ComponentProps<typeof Dropdown>) => {
  const [lastAction, setLastAction] = useState<string>('None')

  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-4">
      <Dropdown
        {...props}
        onSelect={(item) => {
          setLastAction(String(item.value))
          props.onSelect?.(item)
        }}
      />
      <div className="rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2 text-xs text-text-secondary">
        Last action:
        {' '}
        <span className="font-mono text-text-primary">{lastAction}</span>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: args => <DropdownDemo {...args} />,
  args: {
    items: PRIMARY_ITEMS,
    secondItems: SECONDARY_ITEMS,
    onSelect: fn(),
  },
}

export const CustomTrigger: Story = {
  render: args => (
    <DropdownDemo
      {...args}
      renderTrigger={open => (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-divider-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-state-base-hover-alt"
        >
          Actions
          <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
      )}
    />
  ),
  args: {
    items: PRIMARY_ITEMS,
    onSelect: fn(),
  },
}
