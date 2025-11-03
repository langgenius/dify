import type { Meta, StoryObj } from '@storybook/nextjs'
import { useMemo, useState } from 'react'
import Sort from '.'

const SORT_ITEMS = [
  { value: 'created_at', name: 'Created time' },
  { value: 'updated_at', name: 'Updated time' },
  { value: 'latency', name: 'Latency' },
]

const SortPlayground = () => {
  const [sortBy, setSortBy] = useState('-created_at')

  const { order, value } = useMemo(() => {
    const isDesc = sortBy.startsWith('-')
    return {
      order: isDesc ? '-' : '',
      value: sortBy.replace('-', '') || 'created_at',
    }
  }, [sortBy])

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Sort control</span>
        <code className="rounded-md bg-background-default px-2 py-1 text-[11px] text-text-tertiary">
          sort_by="{sortBy}"
        </code>
      </div>
      <Sort
        order={order}
        value={value}
        items={SORT_ITEMS}
        onSelect={(next) => {
          setSortBy(next as string)
        }}
      />
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
        component: 'Sorting trigger used in log tables. Includes dropdown selection and quick toggle between ascending and descending.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SortPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
