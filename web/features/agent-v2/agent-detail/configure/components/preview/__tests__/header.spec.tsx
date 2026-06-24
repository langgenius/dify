import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentPreviewHeader } from '../header'

const mocks = vi.hoisted(() => ({
  refreshDebugConversation: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryKey: () => ['agent'],
        },
        debugConversation: {
          refresh: {
            post: {
              mutationOptions: (options?: { onSuccess?: (data: { debug_conversation_id: string }) => void }) => ({
                mutationFn: mocks.refreshDebugConversation,
                ...options,
              }),
            },
          },
        },
      },
    },
  },
}))

function renderHeader({
  mode = 'preview',
  onModeChange = vi.fn(),
  onOpenVersions = vi.fn(),
  onRestart = vi.fn(),
}: {
  mode?: 'build' | 'preview'
  onModeChange?: (mode: 'build' | 'preview') => void
  onOpenVersions?: () => void
  onRestart?: () => void
} = {}) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['agent'], {
    debug_conversation_id: 'debug-conversation-old',
    name: 'Research Agent',
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentPreviewHeader
        agentId="agent-1"
        mode={mode}
        isChatFeaturesOpen={false}
        onModeChange={onModeChange}
        onToggleChatFeatures={vi.fn()}
        onOpenVersions={onOpenVersions}
        onRestart={onRestart}
      />
    </QueryClientProvider>,
  )

  return {
    queryClient,
  }
}

describe('AgentPreviewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshDebugConversation.mockResolvedValue({
      debug_conversation_id: 'debug-conversation-new',
    })
  })

  it('should refresh debug conversation before clearing preview chat', async () => {
    const onRestart = vi.fn()
    const { queryClient } = renderHeader({ onRestart })

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.preview.restart' }))

    await waitFor(() => expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
    }, expect.any(Object)))
    expect(queryClient.getQueryData(['agent'])).toEqual(expect.objectContaining({
      debug_conversation_id: 'debug-conversation-new',
    }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})
