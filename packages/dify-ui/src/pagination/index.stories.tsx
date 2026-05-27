import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import {
  Pagination,
  PaginationSkeleton,
} from '.'

function PaginationExample({
  initialPage = 2,
  initialPageSize = 25,
  totalPages = 200,
}: {
  initialPage?: number
  initialPageSize?: number
  totalPages?: number
}) {
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)

  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPageChange={setPage}
      pageSize={{
        value: pageSize,
        options: [10, 25, 50],
        onValueChange: setPageSize,
      }}
    />
  )
}

function PaginationDemo(props: ComponentProps<typeof PaginationExample>) {
  return (
    <div className="w-236 max-w-full bg-components-panel-bg px-16 py-10">
      <PaginationExample {...props} />
    </div>
  )
}

function DesignSpecDemo() {
  return (
    <div className="flex w-236 max-w-full flex-col gap-6 bg-components-panel-bg px-16 py-10">
      <PaginationExample />
      <PaginationExample initialPage={2} initialPageSize={25} />
      <PaginationExample initialPage={2} initialPageSize={25} />
      <PaginationExample initialPage={2} initialPageSize={25} />
    </div>
  )
}

const meta = {
  title: 'Base/UI/Pagination',
  component: PaginationDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound pagination primitive for list navigation. It combines semantic page buttons, a NumberField-backed page jump summary, and a SegmentedControl-backed page-size selector.',
      },
    },
  },
  args: {
    initialPage: 2,
    initialPageSize: 25,
    totalPages: 200,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PaginationDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  render: () => <PaginationDemo />,
}

export const DesignSpec: Story = {
  render: () => <DesignSpecDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Pagination rows with default, hover-like, focused, page-size, and skeleton examples.',
      },
    },
  },
}

export const Loading: Story = {
  render: () => <PaginationSkeleton />,
}
