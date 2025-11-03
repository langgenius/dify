import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import ThinkBlock from './think-block'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context'

const THOUGHT_TEXT = `
Gather docs from knowledge base.
Score snippets against query.
[ENDTHINKFLAG]
`

const ThinkBlockDemo = ({
  responding = false,
}: {
  responding?: boolean
}) => {
  const [isResponding, setIsResponding] = useState(responding)

  return (
    <ChatContextProvider
      config={undefined}
      isResponding={isResponding}
      chatList={[]}
      showPromptLog={false}
      questionIcon={undefined}
      answerIcon={undefined}
      onSend={undefined}
      onRegenerate={undefined}
      onAnnotationEdited={undefined}
      onAnnotationAdded={undefined}
      onAnnotationRemoved={undefined}
      onFeedback={undefined}
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
          <span>Think block</span>
          <button
            type="button"
            className="rounded-md border border-divider-subtle bg-background-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
            onClick={() => setIsResponding(prev => !prev)}
          >
            {isResponding ? 'Mark complete' : 'Simulate thinking'}
          </button>
        </div>
        <ThinkBlock data-think>
          <pre className="whitespace-pre-wrap text-sm text-text-secondary">
            {THOUGHT_TEXT}
          </pre>
        </ThinkBlock>
      </div>
    </ChatContextProvider>
  )
}

const meta = {
  title: 'Base/Data Display/ThinkBlock',
  component: ThinkBlockDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Expandable chain-of-thought block used in chat responses. Toggles between “thinking” and completed states.',
      },
    },
  },
  argTypes: {
    responding: { control: 'boolean' },
  },
  args: {
    responding: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ThinkBlockDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
