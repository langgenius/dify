import type { Meta, StoryObj } from '@storybook/react'

import type { ChatItem } from '../../types'
import { mockedWorkflowProcess } from './__mocks__/workflowProcess'
import { markdownContent } from './__mocks__/markdownContent'
import { markdownContentSVG } from './__mocks__/markdownContentSVG'
import Answer from '.'

const meta = {
  title: 'Base/Chat Answer',
  component: Answer,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    noChatInput: { control: 'boolean', description: 'If set to true, some buttons that are supposed to be shown on hover will not be displayed.' },
    responding: { control: 'boolean', description: 'Indicates if the answer is being generated.' },
    showPromptLog: { control: 'boolean', description: 'If set to true, the prompt log button will be shown on hover.' },
  },
  args: {
    noChatInput: false,
    responding: false,
    showPromptLog: false,
  },
} satisfies Meta<typeof Answer>

export default meta
type Story = StoryObj<typeof meta>

const mockedBaseChatItem = {
  id: '1',
  isAnswer: true,
  content: 'Hello, how can I assist you today?',
} satisfies ChatItem

export const Basic: Story = {
  args: {
    item: mockedBaseChatItem,
    question: mockedBaseChatItem.content,
    index: 0,
  },
  render: (args) => {
    return <div className="w-full px-10 py-5">
      <Answer {...args} />
    </div>
  },
}

export const WithWorkflowProcess: Story = {
  args: {
    item: {
      ...mockedBaseChatItem,
      workflowProcess: mockedWorkflowProcess,
    },
    question: mockedBaseChatItem.content,
    index: 0,
  },
  render: (args) => {
    return <div className="w-full px-10 py-5">
      <Answer {...args} />
    </div>
  },
}

export const WithMarkdownContent: Story = {
  args: {
    item: {
      ...mockedBaseChatItem,
      content: markdownContent,
    },
    question: mockedBaseChatItem.content,
    index: 0,
  },
  render: (args) => {
    return <div className="w-full px-10 py-5">
      <Answer {...args} />
    </div>
  },
}

export const WithMarkdownSVG: Story = {
  args: {
    item: {
      ...mockedBaseChatItem,
      content: markdownContentSVG,
    },
    question: mockedBaseChatItem.content,
    index: 0,
  },
  render: (args) => {
    return <div className="w-full px-10 py-5">
      <Answer {...args} />
    </div>
  },
}
