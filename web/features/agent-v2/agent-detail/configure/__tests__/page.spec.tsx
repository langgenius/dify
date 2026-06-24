import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentConfigurePage } from '../page'

const mocks = vi.hoisted(() => ({
  refreshDebugConversation: vi.fn(),
  queryState: {
    agent: {
      data: {
        debug_conversation_id: 'debug-conversation-old',
        icon: 'agent',
        icon_background: '#E0F2FE',
        icon_type: 'emoji',
        name: 'Research Agent',
      },
      isFetching: false,
      isPending: false,
      isSuccess: true,
    },
    composer: {
      data: undefined as unknown,
      isFetching: true,
      isPending: true,
      isSuccess: false,
    },
    version: {
      data: undefined as unknown,
      isFetching: false,
      isPending: false,
      isSuccess: false,
    },
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQuery: vi.fn((options: { queryKey?: readonly string[] }) => {
      const queryKey = options.queryKey?.[0]

      if (queryKey === 'agent')
        return mocks.queryState.agent
      if (queryKey === 'composer')
        return mocks.queryState.composer
      if (queryKey === 'version')
        return mocks.queryState.version

      return {
        data: undefined,
        isFetching: false,
        isPending: false,
        isSuccess: false,
      }
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryOptions: () => ({ queryKey: ['agent'] }),
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
        composer: {
          get: {
            queryOptions: () => ({ queryKey: ['composer'] }),
            queryKey: () => ['composer'],
          },
          put: {
            mutationOptions: () => ({ mutationFn: vi.fn() }),
          },
        },
        versions: {
          byVersionId: {
            get: {
              queryOptions: () => ({ queryKey: ['version'] }),
            },
          },
          get: {
            key: () => ['versions'],
          },
        },
      },
    },
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: undefined }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('../components/orchestrate', () => ({
  AgentOrchestratePanel: () => <div role="region" aria-label="orchestrate-panel" />,
}))

vi.mock('../components/preview/build-chat', () => ({
  AgentBuildChat: (props: {
    conversationId?: string | null
    onConversationIdChange?: (conversationId: string) => void
  }) => (
    <div role="region" aria-label="build-chat">
      <span>{`build:${props.conversationId ?? 'none'}`}</span>
      <button type="button" onClick={() => props.onConversationIdChange?.('build-conversation-new')}>
        save build conversation
      </button>
    </div>
  ),
}))

vi.mock('../components/preview/preview-chat', () => ({
  AgentPreviewChat: (props: {
    conversationId?: string | null
    onConversationIdChange?: (conversationId: string) => void
  }) => (
    <div role="region" aria-label="preview-chat">
      <span>{`preview:${props.conversationId ?? 'none'}`}</span>
      <button type="button" onClick={() => props.onConversationIdChange?.('preview-conversation-new')}>
        save preview conversation
      </button>
    </div>
  ),
}))

vi.mock('../components/preview/chat-features-panel', () => ({
  AgentChatFeaturesPanel: () => null,
}))

vi.mock('../components/preview/header', () => ({
  AgentPreviewHeader: (props: {
    mode: 'build' | 'preview'
    previewEnabled: boolean
    onModeChange: (mode: 'build' | 'preview') => void
    onRefresh: () => void
  }) => (
    <div>
      <div>{props.mode}</div>
      <button type="button" disabled={!props.previewEnabled} onClick={() => props.onModeChange('preview')}>
        preview mode
      </button>
      <button type="button" onClick={() => props.onModeChange('build')}>
        build mode
      </button>
      <button type="button" onClick={props.onRefresh}>
        restart preview
      </button>
    </div>
  ),
}))

vi.mock('../components/preview/versions-panel', () => ({
  AgentPreviewVersionsPanel: (props: { onSelectVersion: (versionId: string) => void }) => (
    <button type="button" onClick={() => props.onSelectVersion('snapshot-2')}>select version</button>
  ),
}))

describe('AgentConfigurePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshDebugConversation.mockResolvedValue({
      debug_conversation_id: 'debug-conversation-new',
    })
    mocks.queryState.agent = {
      data: {
        icon: 'agent',
        icon_background: '#E0F2FE',
        icon_type: 'emoji',
        name: 'Research Agent',
        debug_conversation_id: 'debug-conversation-old',
      },
      isFetching: false,
      isPending: false,
      isSuccess: true,
    }
    mocks.queryState.composer = {
      data: undefined as unknown,
      isFetching: true,
      isPending: true,
      isSuccess: false,
    }
    mocks.queryState.version = {
      data: undefined as unknown,
      isFetching: false,
      isPending: false,
      isSuccess: false,
    }
  })

  describe('Loading state', () => {
    it('should show loading instead of the configure panels while composer data is pending', () => {
      const queryClient = new QueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'orchestrate-panel' })).not.toBeInTheDocument()
    })
  })

  describe('Right panel mode', () => {
    it('should keep preview disabled and stay in build mode', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isPending: false,
        isSuccess: true,
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:debug-conversation-old')
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'save build conversation' }))

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:build-conversation-new')
      expect(mocks.refreshDebugConversation).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'restart preview' }))

      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          debug_conversation_id: 'build-conversation-new',
        },
      }, expect.any(Object))

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')

      const previewButton = screen.getByRole('button', { name: 'preview mode' })
      expect(previewButton).toBeDisabled()

      await user.click(previewButton)

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()
    })

    it('should keep preview disabled', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isPending: false,
        isSuccess: true,
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      const previewButton = screen.getByRole('button', { name: 'preview mode' })
      expect(previewButton).toBeDisabled()

      await user.click(previewButton)

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:debug-conversation-old')
      expect(screen.queryByRole('region', { name: 'preview-chat', hidden: true })).not.toBeInTheDocument()
    })
  })
})
