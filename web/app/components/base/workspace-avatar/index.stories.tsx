import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { WorkspaceAvatar } from '.'

const meta = {
  title: 'Base/General/WorkspaceAvatar',
  component: WorkspaceAvatar,
  parameters: {
    docs: {
      description: {
        component: 'Square workspace avatar with the shared workspace fallback-initial treatment.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    name: 'Solar Studio',
    size: 'sm',
  },
} satisfies Meta<typeof WorkspaceAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      {(['xs', 'sm', 'lg', '2xl'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <WorkspaceAvatar {...args} size={size} />
          <span className="text-xs text-text-tertiary uppercase">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const MissingName: Story = {
  args: {
    name: undefined,
  },
}
