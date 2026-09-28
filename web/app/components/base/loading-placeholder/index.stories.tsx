import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { LoadingPlaceholder } from '.'

const meta = {
  title: 'Base/Feedback/LoadingPlaceholder',
  component: LoadingPlaceholder,
  parameters: { layout: 'centered' },
  args: { label: 'Loading content' },
  tags: ['autodocs'],
} satisfies Meta<typeof LoadingPlaceholder>

export default meta
type Story = StoryObj<typeof meta>

export const ContentSlot: Story = {
  render: (args) => <LoadingPlaceholder {...args} className="h-20 w-64" />,
}

export const RemainingSpace: Story = {
  render: (args) => (
    <div className="flex h-64 w-80 flex-col rounded-xl border border-divider-subtle">
      <div className="p-4">Panel header</div>
      <LoadingPlaceholder {...args} className="flex-1" />
    </div>
  ),
}

export const Pagination: Story = {
  render: (args) => <LoadingPlaceholder {...args} className="my-3 w-64" />,
}
