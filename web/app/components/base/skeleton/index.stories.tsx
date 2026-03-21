import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '.'

const SkeletonDemo = () => {
  return (
    <div className="flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Loading skeletons</div>
      <div className="space-y-4 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
        <SkeletonContainer>
          <SkeletonRow>
            <SkeletonRectangle className="h-4 w-32 rounded-md" />
            <SkeletonPoint />
            <SkeletonRectangle className="h-4 w-20 rounded-md" />
          </SkeletonRow>
          <SkeletonRow>
            <SkeletonRectangle className="h-3 w-full" />
          </SkeletonRow>
          <SkeletonRow>
            <SkeletonRectangle className="h-3 w-5/6" />
          </SkeletonRow>
        </SkeletonContainer>
      </div>
      <div className="space-y-3 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
        <SkeletonRow className="items-start">
          <SkeletonRectangle className="mr-4 h-10 w-10 rounded-full" />
          <SkeletonContainer className="w-full">
            <SkeletonRectangle className="h-3 w-1/3" />
            <SkeletonRectangle className="h-3 w-full" />
            <SkeletonRectangle className="h-3 w-3/4" />
          </SkeletonContainer>
        </SkeletonRow>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/Skeleton',
  component: SkeletonDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Composable skeleton primitives (container, row, rectangle, point) to sketch loading states for panels and lists.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SkeletonDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
