import type { AgentChatRuntimeProps } from '../chat-runtime'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { render } from '@/test/console/render'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentPreviewChat } from '../preview-chat'

vi.mock('../chat-runtime', () => ({
  AgentChatRuntime: ({ renderEmptyState }: AgentChatRuntimeProps) =>
    renderEmptyState({ showUnconfiguredNotice: false }),
}))

const commonProps = {
  agentId: 'agent-1',
  clearChatList: false,
  onClearChatListChange: vi.fn(),
}

const agentQueryOptions = consoleQuery.agent.byAgentId.get.queryOptions({
  input: { params: { agent_id: commonProps.agentId } },
})

function renderPreview(agent: ReturnType<typeof createAgentFixture>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(agentQueryOptions.queryKey, agent)

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AgentPreviewChat {...commonProps} />
      </QueryClientProvider>,
    ),
  }
}

describe('Agent preview avatar', () => {
  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32)
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders an external image from the raw icon when icon_url is null', () => {
    const { container } = renderPreview(
      createAgentFixture({
        icon_type: 'link',
        icon: 'https://example.com/avatar.png',
        icon_url: null,
      }),
    )

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/avatar.png')
  })

  it('shows a fallback without exposing the file ID when its signed URL is unavailable', () => {
    const { container } = renderPreview(
      createAgentFixture({
        icon_type: 'image',
        icon: 'uploaded-file-id',
        icon_url: null,
      }),
    )

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.queryByText('uploaded-file-id')).not.toBeInTheDocument()
    expect(screen.getByText('🤖')).toBeInTheDocument()
  })

  it('updates the avatar and name when the shared Agent query changes', async () => {
    const { queryClient, container } = renderPreview(
      createAgentFixture({
        name: 'Original Agent',
        icon_type: 'image',
        icon: 'uploaded-file-id',
        icon_url: 'https://files.example.com/avatar.png?sign=signature',
      }),
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://files.example.com/avatar.png?sign=signature',
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Original Agent')).toBeInTheDocument()

    await act(async () => {
      queryClient.setQueryData(
        agentQueryOptions.queryKey,
        createAgentFixture({
          name: 'Updated Agent',
          icon_type: 'emoji',
          icon: '🚀',
          icon_url: null,
        }),
      )
    })

    expect(await screen.findByText('Updated Agent')).toBeInTheDocument()
    expect(screen.queryByText('Original Agent')).not.toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('🚀')).toBeInTheDocument()
  })
})
