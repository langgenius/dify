import { render, screen } from '@testing-library/react'
import { AgentConfigurePage } from '../page'

const mocks = vi.hoisted(() => ({
  queryState: {
    agent: {
      data: {
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
      data: undefined,
      isFetching: true,
      isPending: true,
      isSuccess: false,
    },
    version: {
      data: undefined,
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
        },
        composer: {
          get: {
            queryOptions: () => ({ queryKey: ['composer'] }),
          },
        },
        versions: {
          byVersionId: {
            get: {
              queryOptions: () => ({ queryKey: ['version'] }),
            },
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

vi.mock('../components/preview/chat', () => ({
  AgentPreviewChat: () => <div role="region" aria-label="preview-chat" />,
}))

vi.mock('../components/preview/chat-features-panel', () => ({
  AgentChatFeaturesPanel: () => null,
}))

vi.mock('../components/preview/header', () => ({
  AgentPreviewHeader: () => <div role="banner" />,
}))

vi.mock('../components/preview/versions-panel', () => ({
  AgentPreviewVersionsPanel: () => null,
}))

describe('AgentConfigurePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryState.agent = {
      data: {
        icon: 'agent',
        icon_background: '#E0F2FE',
        icon_type: 'emoji',
        name: 'Research Agent',
      },
      isFetching: false,
      isPending: false,
      isSuccess: true,
    }
    mocks.queryState.composer = {
      data: undefined,
      isFetching: true,
      isPending: true,
      isSuccess: false,
    }
    mocks.queryState.version = {
      data: undefined,
      isFetching: false,
      isPending: false,
      isSuccess: false,
    }
  })

  describe('Loading state', () => {
    it('should show loading instead of the configure panels while composer data is pending', () => {
      render(<AgentConfigurePage agentId="agent-1" />)

      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'orchestrate-panel' })).not.toBeInTheDocument()
    })
  })
})
