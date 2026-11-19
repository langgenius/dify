import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { SortValue } from '.'
import { useState } from 'react'
import { Sort } from '.'

const SORT_ITEMS = [
  { value: 'created_at', name: 'Created time' },
  { value: 'updated_at', name: 'Updated time' },
  { value: 'latency', name: 'Latency' },
] as const

const SortPlayground = () => {
  const [value, setValue] = useState<SortValue<(typeof SORT_ITEMS)[number]['value']>>({
    field: 'created_at',
    order: 'desc',
  })

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs tracking-[0.18em] text-text-tertiary uppercase">
        <span>Sort control</span>
        <code className="rounded-md bg-background-default px-2 py-1 text-[11px] text-text-tertiary">
          {JSON.stringify(value)}
        </code>
      </div>
      <Sort value={value} items={SORT_ITEMS} onValueChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/Sort',
  component: SortPlayground,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Sorting trigger used in log tables. Includes dropdown selection and quick toggle between ascending and descending.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SortPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
