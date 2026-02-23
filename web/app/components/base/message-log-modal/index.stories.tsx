import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing, NodeTracingListResponse } from '@/types/workflow'
import { useEffect } from 'react'
import { useStore } from '@/app/components/app/store'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { BlockEnum } from '@/app/components/workflow/types'
import MessageLogModal from '.'

const SAMPLE_APP_DETAIL = {
  id: 'app-demo-1',
  name: 'Support Assistant',
  mode: 'chat',
} as any

const mockRunDetail: WorkflowRunDetailResponse = {
  id: 'run-demo-1',
  version: 'v1.0.0',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: JSON.stringify({ question: 'How do I reset my password?' }, null, 2),
  inputs_truncated: false,
  status: 'succeeded',
  outputs: JSON.stringify({ answer: 'Follow the reset link we just emailed you.' }, null, 2),
  outputs_truncated: false,
  total_steps: 3,
  created_by_role: 'account',
  created_by_account: {
    id: 'account-1',
    name: 'Demo Admin',
    email: 'demo@example.com',
  },
  created_at: 1700000000,
  finished_at: 1700000006,
  elapsed_time: 5.2,
  total_tokens: 864,
}

const buildNode = (override: Partial<NodeTracing>): NodeTracing => ({
  id: 'node-start',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-start',
  node_type: BlockEnum.Start,
  title: 'Start',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded',
  metadata: {
    iterator_length: 1,
    iterator_index: 0,
    loop_length: 1,
    loop_index: 0,
  },
  created_at: 1700000000,
  created_by: {
    id: 'account-1',
    name: 'Demo Admin',
    email: 'demo@example.com',
  },
  finished_at: 1700000001,
  elapsed_time: 1.1,
  extras: {},
  ...override,
})

const mockTracingList: NodeTracingListResponse = {
  data: [
    buildNode({}),
    buildNode({
      id: 'node-answer',
      node_id: 'node-answer',
      node_type: BlockEnum.Answer,
      title: 'Answer',
      inputs: { prompt: 'How do I reset my password?' },
      outputs: { output: 'Follow the reset link we just emailed you.' },
      finished_at: 1700000005,
      elapsed_time: 2.6,
    }),
  ],
}

const mockCurrentLogItem: IChatItem = {
  id: 'message-1',
  content: 'Follow the reset link we just emailed you.',
  isAnswer: true,
  workflow_run_id: 'run-demo-1',
}

const useMessageLogMocks = () => {
  useEffect(() => {
    const store = useStore.getState()
    store.setAppDetail(SAMPLE_APP_DETAIL)

    const originalFetch = globalThis.fetch?.bind(globalThis) ?? null

    const handle = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.includes('/workflow-runs/run-demo-1/') && url.endsWith('/node-executions')) {
        return new Response(
          JSON.stringify(mockTracingList),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        )
      }

      if (url.endsWith('/workflow-runs/run-demo-1')) {
        return new Response(
          JSON.stringify(mockRunDetail),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        )
      }

      if (originalFetch)
        return originalFetch(input, init)

      throw new Error(`Unmocked fetch call for ${url}`)
    }

    globalThis.fetch = handle as typeof globalThis.fetch

    return () => {
      globalThis.fetch = originalFetch || globalThis.fetch
      useStore.getState().setAppDetail(undefined)
    }
  }, [])
}

type MessageLogModalProps = React.ComponentProps<typeof MessageLogModal>

const MessageLogPreview = (props: MessageLogModalProps) => {
  useMessageLogMocks()

  return (
    <div className="relative min-h-[640px] w-full bg-background-default-subtle p-6">
      <WorkflowContextProvider>
        <MessageLogModal
          {...props}
          currentLogItem={mockCurrentLogItem}
        />
      </WorkflowContextProvider>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/MessageLogModal',
  component: MessageLogPreview,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Workflow run inspector presented alongside chat transcripts. This Storybook mock provides canned run details and tracing metadata.',
      },
    },
  },
  args: {
    defaultTab: 'DETAIL',
    width: 960,
    fixedWidth: true,
    onCancel: () => {
      console.log('Modal closed')
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageLogPreview>

export default meta
type Story = StoryObj<typeof meta>

export const FixedPanel: Story = {}

export const FloatingPanel: Story = {
  args: {
    fixedWidth: false,
  },
}
