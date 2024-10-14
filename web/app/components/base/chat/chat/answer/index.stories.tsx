import type { Meta, StoryObj } from '@storybook/react'

import type { ChatItem } from '../../types'
import Answer from '.'

const meta = {
  title: 'Base/Chat Answer',
  component: Answer,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {},
  args: {},
} satisfies Meta<typeof Answer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    item: {
      id: '1',
      isAnswer: true,
      content: 'Hello, how can I assist you today?',
    } satisfies ChatItem,
    question: 'asdf',
    index: 0,
  },
  render: (args) => {
    return <div className="w-full px-10 py-5">
      <Answer {...args} />
    </div>
  },
}
