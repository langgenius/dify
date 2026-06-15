import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { useEffect } from 'react'
import { useStore } from '@/app/components/app/store'
import PromptLogModal from '.'

type PromptLogModalProps = React.ComponentProps<typeof PromptLogModal>

const mockLogItem: IChatItem = {
  id: 'message-1',
  isAnswer: true,
  content: 'Summarize our meeting notes about launch blockers.',
  log: [
    {
      role: 'system',
      text: 'You are an assistant that extracts key launch blockers from the dialogue.',
    },
    {
      role: 'user',
      text: 'Team discussed QA, marketing assets, and infra readiness. Highlight risks.',
    },
    {
      role: 'assistant',
      text: 'Blocking items:\n1. QA needs staging data by Friday.\n2. Marketing awaiting final visuals.\n3. Infra rollout still missing approval.',
    },
  ],
}

const usePromptLogMocks = () => {
  useEffect(() => {
    useStore.getState().setCurrentLogItem(mockLogItem)
    return () => {
      useStore.getState().setCurrentLogItem(undefined)
    }
  }, [])
}

const PromptLogPreview = (props: PromptLogModalProps) => {
  usePromptLogMocks()

  return (
    <div className="relative min-h-[540px] w-full bg-background-default-subtle p-6">
      <PromptLogModal
        {...props}
        currentLogItem={mockLogItem}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/PromptLogModal',
  component: PromptLogPreview,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Shows the prompt and message transcript used for a chat completion, with copy-to-clipboard support for single prompts.',
      },
    },
  },
  args: {
    width: 960,
    onCancel: () => {
      console.log('Prompt log closed')
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PromptLogPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
