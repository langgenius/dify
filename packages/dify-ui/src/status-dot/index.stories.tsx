import type { Meta, StoryObj } from '@storybook/react-vite'
import type { StatusDotProps, StatusDotStatus } from '.'
import * as React from 'react'
import { StatusDot, StatusDotSkeleton } from '.'

type StatusDotSize = NonNullable<StatusDotProps['size']>

const statuses: StatusDotStatus[] = ['success', 'warning', 'error', 'normal', 'disabled']
const sizes: StatusDotSize[] = ['small', 'medium']

const meta = {
  title: 'Base/UI/StatusDot',
  component: StatusDot,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Decorative Status Dot primitive from the Dify Design Kit. Pair it with visible status text owned by the surrounding component; the dot itself stays hidden from assistive technology.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof StatusDot>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    status: 'success',
    size: 'medium',
  },
}

export const Matrix: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_auto_auto] items-center gap-4">
      <div />
      <div className="system-xs-medium text-text-tertiary">Small</div>
      <div className="system-xs-medium text-text-tertiary">Medium</div>
      {statuses.map((status) => (
        <React.Fragment key={status}>
          <div className="system-xs-semibold-uppercase text-text-secondary">{status}</div>
          {sizes.map((size) => (
            <StatusDot key={`${status}-${size}`} status={status} size={size} />
          ))}
        </React.Fragment>
      ))}
    </div>
  ),
}

export const Skeleton: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <StatusDotSkeleton size="small" />
      <StatusDotSkeleton size="medium" />
    </div>
  ),
}
