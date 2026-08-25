import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect } from 'storybook/test'
import { Pagination, PaginationSkeleton } from '.'

function PaginationExample({
  initialPage = 2,
  initialPageSize = 25,
  totalPages = 200,
  label = 'Pagination',
}: {
  initialPage?: number
  initialPageSize?: number
  totalPages?: number
  label?: string
}) {
  const [page, setPage] = React.useState(initialPage)
  const [pageSize, setPageSize] = React.useState(initialPageSize)

  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      aria-label={label}
      onPageChange={setPage}
      pageSize={{
        value: pageSize,
        options: [10, 25, 50],
        onValueChange: setPageSize,
      }}
    />
  )
}

function PaginationDemo(props: React.ComponentProps<typeof PaginationExample>) {
  return (
    <div className="w-236 max-w-full bg-components-panel-bg px-16 py-10">
      <PaginationExample {...props} />
    </div>
  )
}

function RangeStatesDemo() {
  return (
    <div className="flex w-236 max-w-full flex-col gap-6 bg-components-panel-bg px-16 py-10">
      <PaginationExample label="Pagination near the start" initialPage={2} />
      <PaginationExample label="Pagination in the middle" initialPage={100} />
      <PaginationExample label="Pagination near the end" initialPage={199} />
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
        component:
          'Compound pagination primitive for list navigation. It combines semantic page buttons, a NumberField-backed page jump summary, and a SegmentedControl-backed page-size selector.',
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
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole('button', { name: 'Edit page number, current page 2 of 200' }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Next page' }))
    await expect(
      canvas.getByRole('button', { name: 'Edit page number, current page 3 of 200' }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('radio', { name: '50' }))
    await expect(canvas.getByRole('radio', { name: '50' })).toHaveAttribute('aria-checked', 'true')
  },
}

export const RangeStates: Story = {
  render: () => <RangeStatesDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Pagination windows near the beginning, middle, and end of a long result set.',
      },
    },
  },
}

export const Loading: Story = {
  render: () => <PaginationSkeleton />,
}
