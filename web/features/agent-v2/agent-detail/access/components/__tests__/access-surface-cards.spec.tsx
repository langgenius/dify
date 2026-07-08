import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServiceApiAccessCard } from '../service-api-access-card'
import { WebAppAccessCard } from '../web-app-access-card'

const mocks = vi.hoisted(() => ({
  apiAccessQueryFn: vi.fn(),
  apiKeysQueryFn: vi.fn(),
  siteEnableMutation: vi.fn(),
  siteMutation: vi.fn(),
  siteAccessTokenResetMutation: vi.fn(),
  apiEnableMutation: vi.fn(),
  createApiKeyMutation: vi.fn(),
  deleteApiKeyMutation: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `formatted-${value}`,
  }),
}))

vi.mock('@/app/components/base/chat/embedded-chatbot/theme/theme-context', () => ({
  useThemeContext: () => ({
    buildTheme: vi.fn(),
    theme: {
      primaryColor: '#1C64F2',
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    langGeniusVersionInfo: {
      current_env: 'PRODUCTION',
    },
  }),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    currentWorkspace: { id: 'workspace-1' },
    workspacePermissionKeys: ['app.acl.edit'],
    langGeniusVersionInfo: {
      current_env: 'PRODUCTION',
      current_version: '',
      latest_version: '',
      version: '',
      release_date: '',
      release_notes: '',
      can_auto_update: false,
    },
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        siteEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.siteEnableMutation,
              ...options,
            }),
          },
        },
        site: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.siteMutation,
              ...options,
            }),
          },
          accessTokenReset: {
            post: {
              mutationOptions: (options = {}) => ({
                mutationFn: mocks.siteAccessTokenResetMutation,
                ...options,
              }),
            },
          },
        },
      },
    },
    agent: {
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => ['agent-detail', input.params.agent_id],
        },
        apiAccess: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => ['agent-api-access', input.params.agent_id],
            queryOptions: ({ input }: { input: { params: { agent_id: string } } }) => ({
              queryKey: ['agent-api-access', input.params.agent_id],
              queryFn: () => mocks.apiAccessQueryFn(input),
            }),
          },
        },
        apiEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.apiEnableMutation,
              ...options,
            }),
          },
        },
        apiKeys: {
          get: {
            queryOptions: ({ input }: { input: { params: { agent_id: string } } }) => ({
              queryKey: ['agent-api-keys', input.params.agent_id],
              queryFn: () => mocks.apiKeysQueryFn(input),
            }),
          },
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.createApiKeyMutation,
              ...options,
            }),
          },
          byApiKeyId: {
            delete: {
              mutationOptions: (options = {}) => ({
                mutationFn: mocks.deleteApiKeyMutation,
                ...options,
              }),
            },
          },
        },
      },
    },
  },
}))

function createAgent(overrides: Partial<AgentAppDetailWithSite> = {}): AgentAppDetailWithSite {
  return {
    enable_api: true,
    enable_site: true,
    icon_url: null,
    id: 'agent-1',
    mode: 'agent',
    name: 'Support Agent',
    app_id: 'app-1',
    api_base_url: 'https://api.example.test/v1',
    access_mode: 'sso_verified',
    site: {
      access_token: 'site-token',
      app_base_url: 'https://chat.example.test',
      chat_color_theme_inverted: false,
      default_language: 'en-US',
      icon_url: null,
      show_workflow_steps: false,
      title: 'Support Agent',
      use_icon_as_answer_icon: false,
    } as NonNullable<AgentAppDetailWithSite['site']> & {
      access_token: string
      app_base_url: string
    },
    ...overrides,
  }
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )

  return queryClient
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

describe('Agent access surface cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Web app access', () => {
    it('should render the backend web app URL and toggle site status through the backing app id', async () => {
      const user = userEvent.setup()
      mocks.siteEnableMutation.mockResolvedValueOnce({ enable_site: false })

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      expect(screen.getByText('https://chat.example.test/agent/site-token')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'agentV2.agentDetail.access.webApp.actions.launch' })).toHaveAttribute('href', 'https://chat.example.test/agent/site-token')
      expect(screen.getByText('agentV2.agentDetail.access.webApp.ssoEnabled')).toBeInTheDocument()

      await user.click(screen.getByRole('switch', { name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.webApp.title"}' }))

      await waitFor(() => {
        expect(mocks.siteEnableMutation.mock.calls[0]?.[0]).toEqual({
          params: {
            app_id: 'app-1',
          },
          body: {
            enable_site: false,
          },
        })
      })
    })

    it('should open the customize dialog with the backing app id and API base URL', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.customize' }))

      const dialog = await screen.findByRole('dialog', { name: 'appOverview.overview.appInfo.customize.title' })
      expect(dialog).toHaveTextContent(/NEXT_PUBLIC_APP_ID=\s*'app-1'/)
      expect(dialog).toHaveTextContent(/NEXT_PUBLIC_API_URL=\s*'https:\/\/api\.example\.test\/v1'/)
      expect(within(dialog).getByRole('button', { name: /appOverview\.overview\.appInfo\.customize\.way1\.step1Operation/ })).toHaveAttribute('href', 'https://github.com/langgenius/webapp-conversation')
    })

    it('should open the embedded dialog with the Agent web app route', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' }))

      const dialog = await screen.findByRole('dialog', { name: 'appOverview.overview.appInfo.embedded.title' })
      await waitFor(() => {
        expect(dialog).toHaveTextContent('https://chat.example.test/agent/site-token')
      })

      await user.click(within(dialog).getByRole('button', { name: 'appOverview.overview.appInfo.embedded.scripts' }))

      await waitFor(() => {
        expect(dialog).toHaveTextContent('routeSegment: \'agent\'')
      })
    })

    it('should close the embedded dialog from the close button', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' }))
      const dialog = await screen.findByRole('dialog', { name: 'appOverview.overview.appInfo.embedded.title' })

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'appOverview.overview.appInfo.embedded.title' })).not.toBeInTheDocument()
      })
    })

    it('should save settings through the backing app id and update the agent detail cache', async () => {
      const user = userEvent.setup()
      const agent = createAgent()
      mocks.siteMutation.mockResolvedValueOnce({
        app_id: 'app-1',
        code: 'new-site-token',
        copyright: '',
        custom_disclaimer: '',
        customize_domain: null,
        customize_token_strategy: 'allow',
        default_language: 'en-US',
        description: 'Updated web description.',
        icon: '🤖',
        icon_background: '#FFEAD5',
        privacy_policy: '',
        prompt_public: false,
        show_workflow_steps: false,
        title: 'Support Portal',
        use_icon_as_answer_icon: true,
      })

      const queryClient = renderWithQueryClient(
        <WebAppAccessCard agent={agent} agentId="agent-1" isLoading={false} />,
      )
      queryClient.setQueryData(['agent-detail', 'agent-1'], agent)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }))
      const dialog = await screen.findByRole('dialog', { name: 'appOverview.overview.appInfo.settings.title' })

      await user.clear(within(dialog).getByPlaceholderText('app.appNamePlaceholder'))
      await user.type(within(dialog).getByPlaceholderText('app.appNamePlaceholder'), 'Support Portal')
      await user.clear(within(dialog).getByRole('textbox', { name: 'appOverview.overview.appInfo.settings.webDesc' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'appOverview.overview.appInfo.settings.webDesc' }), 'Updated web description.')
      await user.clear(within(dialog).getByPlaceholderText('E.g #A020F0'))
      await user.type(within(dialog).getByPlaceholderText('E.g #A020F0'), '#123456')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mocks.siteMutation.mock.calls[0]?.[0]).toEqual({
          params: {
            app_id: 'app-1',
          },
          body: expect.objectContaining({
            title: 'Support Portal',
            description: 'Updated web description.',
            chat_color_theme: '#123456',
          }),
        })
      })
      expect(mocks.siteMutation.mock.calls[0]?.[0].body).not.toHaveProperty('enable_sso')
      expect(queryClient.getQueryData<AgentAppDetailWithSite>(['agent-detail', 'agent-1'])).toMatchObject({
        site: {
          access_token: 'new-site-token',
          chat_color_theme: '#123456',
          description: 'Updated web description.',
          title: 'Support Portal',
        },
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['agent-detail', 'agent-1'] })
    })

    it('should keep embedded disabled until the backing app id and web app token are available', () => {
      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({
            app_id: null,
            site: {
              ...createAgent().site!,
              access_token: null,
              code: null,
            },
          })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      expect(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' })).toBeDisabled()
    })

    it('should keep settings disabled until the backing app id and site data are available', () => {
      const agentWithoutApp = createAgent({
        app_id: null,
      })
      const agentWithoutSite = createAgent({
        site: null,
      })
      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <WebAppAccessCard agent={agentWithoutApp} agentId="agent-1" isLoading={false} />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' })).toBeDisabled()

      rerender(
        <QueryClientProvider client={queryClient}>
          <WebAppAccessCard agent={agentWithoutSite} agentId="agent-1" isLoading={false} />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' })).toBeDisabled()
    })

    it('should keep customize disabled until the generated contract provides the required fields', () => {
      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent({ api_base_url: null })} agentId="agent-1" isLoading={false} />,
      )

      expect(screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.customize' })).toBeDisabled()
    })
  })

  describe('Service API access', () => {
    it('should render service API data and toggle Agent API status through the generated Agent endpoint', async () => {
      const user = userEvent.setup()
      mocks.apiAccessQueryFn.mockResolvedValueOnce({
        api_key_count: 2,
        enabled: true,
        service_api_base_url: 'https://api.example.test/v1',
      })
      mocks.apiEnableMutation.mockResolvedValueOnce({
        api_key_count: 2,
        enabled: false,
        service_api_base_url: 'https://api.example.test/v1',
      })

      renderWithQueryClient(<ServiceApiAccessCard agentId="agent-1" />)

      expect(await screen.findByText('https://api.example.test/v1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()

      await user.click(screen.getByRole('switch', { name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.serviceApi.title"}' }))

      await waitFor(() => {
        expect(mocks.apiEnableMutation.mock.calls[0]?.[0]).toEqual({
          params: {
            agent_id: 'agent-1',
          },
          body: {
            enable_api: false,
          },
        })
      })
    })

    it('should manage API keys with the Agent API key endpoints', async () => {
      const user = userEvent.setup()
      mocks.apiAccessQueryFn.mockResolvedValue({
        api_key_count: 1,
        enabled: true,
        service_api_base_url: 'https://api.example.test/v1',
      })
      mocks.apiKeysQueryFn.mockResolvedValue({
        data: [
          {
            created_at: 1781660000,
            id: 'key-1',
            last_used_at: null,
            token: 'app-existing-secret-key-token',
            type: 'app',
          },
        ],
      })
      mocks.createApiKeyMutation.mockResolvedValueOnce({
        created_at: 1781660100,
        id: 'key-2',
        last_used_at: null,
        token: 'app-new-secret-key-token',
        type: 'app',
      })
      mocks.deleteApiKeyMutation.mockResolvedValueOnce(undefined)

      renderWithQueryClient(<ServiceApiAccessCard agentId="agent-1" />)

      await user.click(await screen.findByRole('button', { name: /agentV2\.agentDetail\.access\.serviceApi\.actions\.apiKey/ }))

      const dialog = await screen.findByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' })
      expect(await within(dialog).findByText('app...ing-secret-key-token')).toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))

      await waitFor(() => {
        expect(mocks.createApiKeyMutation.mock.calls[0]?.[0]).toEqual({
          params: {
            agent_id: 'agent-1',
          },
        })
      })
      expect(await screen.findByText('appApi.apiKeyModal.generateTips')).toBeInTheDocument()
      expect(screen.getByText('app-new-secret-key-token')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'appApi.actionMsg.ok' }))

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mocks.deleteApiKeyMutation.mock.calls[0]?.[0]).toEqual({
          params: {
            agent_id: 'agent-1',
            api_key_id: 'key-1',
          },
        })
      })
    })
  })
})
