import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ChatItem } from '../types'
import { User } from '@/app/components/base/icons/src/public/avatar'
import Question from './question'

const meta = {
  title: 'Base/Other/Chat Question',
  component: Question,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {},
  args: {},
} satisfies Meta<typeof Question>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    item: {
      id: '1',
      isAnswer: false,
      content: 'You are a helpful assistant.',
    } satisfies ChatItem,
    theme: undefined,
    questionIcon: (
      <div className="h-full w-full rounded-full border-[0.5px] border-black/5">
        <User className="h-full w-full" />
      </div>
    ),
  },
}
