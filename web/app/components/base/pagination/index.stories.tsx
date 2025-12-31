import type { Meta, StoryObj } from '@storybook/nextjs'
import { useMemo, useState } from 'react'
import Pagination from '.'

const TOTAL_ITEMS = 120

const PaginationDemo = ({
  initialPage = 0,
  initialLimit = 10,
}: {
  initialPage?: number
  initialLimit?: number
}) => {
  const [current, setCurrent] = useState(initialPage)
  const [limit, setLimit] = useState(initialLimit)

  const pageSummary = useMemo(() => {
    const start = current * limit + 1
    const end = Math.min((current + 1) * limit, TOTAL_ITEMS)
    return `${start}-${end} of ${TOTAL_ITEMS}`
  }, [current, limit])

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Log pagination</span>
        <span className="rounded-md border border-divider-subtle bg-background-default px-2 py-1 font-medium text-text-secondary">
          {pageSummary}
        </span>
      </div>
      <Pagination
        current={current}
        total={TOTAL_ITEMS}
        limit={limit}
        onChange={setCurrent}
        onLimitChange={(nextLimit) => {
          setCurrent(0)
          setLimit(nextLimit)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Navigation/Pagination',
  component: PaginationDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Paginate long lists with optional per-page selector. Demonstrates the inline page jump input and quick limit toggles.',
      },
    },
  },
  args: {
    initialPage: 0,
    initialLimit: 10,
  },
  argTypes: {
    initialPage: {
      control: { type: 'number', min: 0, max: 9, step: 1 },
    },
    initialLimit: {
      control: { type: 'radio' },
      options: [10, 25, 50],
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PaginationDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const StartAtMiddle: Story = {
  args: {
    initialPage: 4,
  },
}
