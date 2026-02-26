import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { AgentLogDetailResponse } from '@/models/log'
import { useEffect, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastProvider } from '@/app/components/base/toast'
import AgentLogModal from '.'

const MOCK_RESPONSE: AgentLogDetailResponse = {
  meta: {
    status: 'finished',
    executor: 'Agent Runner',
    start_time: '2024-03-12T10:00:00Z',
    elapsed_time: 12.45,
    total_tokens: 2589,
    agent_mode: 'ReACT',
    iterations: 2,
    error: undefined,
  },
  iterations: [
    {
      created_at: '2024-03-12T10:00:05Z',
      files: [],
      thought: JSON.stringify({ reasoning: 'Summarise conversation' }, null, 2),
      tokens: 934,
      tool_calls: [
        {
          status: 'success',
          tool_icon: null,
          tool_input: { query: 'Latest revenue numbers' },
          tool_output: { answer: 'Revenue up 12% QoQ' },
          tool_name: 'search',
          tool_label: {
            'en-US': 'Revenue Search',
          },
          time_cost: 1.8,
        },
      ],
      tool_raw: {
        inputs: JSON.stringify({ context: 'Summaries' }, null, 2),
        outputs: JSON.stringify({ observation: 'Revenue up 12% QoQ' }, null, 2),
      },
    },
    {
      created_at: '2024-03-12T10:00:09Z',
      files: [],
      thought: JSON.stringify({ final: 'Revenue increased 12% quarter-over-quarter.' }, null, 2),
      tokens: 642,
      tool_calls: [],
      tool_raw: {
        inputs: JSON.stringify({ context: 'Compose summary' }, null, 2),
        outputs: JSON.stringify({ observation: 'Final answer ready' }, null, 2),
      },
    },
  ],
  files: [],
}

const MOCK_CHAT_ITEM: IChatItem = {
  id: 'message-1',
  content: JSON.stringify({ answer: 'Revenue grew 12% QoQ.' }, null, 2),
  input: JSON.stringify({ question: 'Summarise revenue trends.' }, null, 2),
  isAnswer: true,
  conversationId: 'conv-123',
}

const AgentLogModalDemo = ({
  width = 960,
}: {
  width?: number
}) => {
  const originalFetchRef = useRef<typeof globalThis.fetch>(null)
  const setAppDetail = useAppStore(state => state.setAppDetail)

  useEffect(() => {
    setAppDetail({
      id: 'app-1',
      name: 'Analytics Agent',
      mode: 'agent-chat',
    } as any)

    originalFetchRef.current = globalThis.fetch?.bind(globalThis)

    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = request.url
      const parsed = new URL(url, window.location.origin)

      if (parsed.pathname.endsWith('/apps/app-1/agent/logs')) {
        return new Response(JSON.stringify(MOCK_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (originalFetchRef.current)
        return originalFetchRef.current(request)

      throw new Error(`Unhandled request: ${url}`)
    }

    globalThis.fetch = handler as typeof globalThis.fetch

    return () => {
      if (originalFetchRef.current)
        globalThis.fetch = originalFetchRef.current
      setAppDetail(undefined)
    }
  }, [setAppDetail])

  return (
    <ToastProvider>
      <div className="relative min-h-[540px] w-full bg-background-default-subtle p-6">
        <AgentLogModal
          currentLogItem={MOCK_CHAT_ITEM}
          width={width}
          onCancel={() => {
            console.log('Agent log modal closed')
          }}
        />
      </div>
    </ToastProvider>
  )
}

const meta = {
  title: 'Base/Other/AgentLogModal',
  component: AgentLogModalDemo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Agent execution viewer showing iterations, tool calls, and metadata. Fetch responses are mocked for Storybook.',
      },
    },
  },
  args: {
    width: 960,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AgentLogModalDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
