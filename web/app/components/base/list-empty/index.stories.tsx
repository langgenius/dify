import type { Meta, StoryObj } from '@storybook/nextjs'
import ListEmpty from '.'

const meta = {
  title: 'Base/Data Display/ListEmpty',
  component: ListEmpty,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Large empty state card used in panels and drawers to hint at the next action for the user.',
      },
    },
  },
  args: {
    title: 'No items yet',
    description: (
      <p className="text-xs leading-5 text-text-tertiary">
        Add your first entry to see it appear here. Empty states help users discover what happens next.
      </p>
    ),
  },
  argTypes: {
    description: { control: false },
    icon: { control: false },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ListEmpty>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithCustomIcon: Story = {
  args: {
    title: 'Connect a data source',
    description: (
      <p className="text-xs leading-5 text-text-secondary">
        Choose a database, knowledge base, or upload documents to get started with retrieval.
      </p>
    ),
    icon: (
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-100 via-primary-200 to-primary-300 text-primary-700 shadow-sm">
        {'\u{26A1}\u{FE0F}'}
      </div>
    ),
  },
}
