import type {
  AgentApiAccessResponse,
  AgentAppDetailWithSite,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AppDetail } from '@dify/contracts/api/console/apps/types.gen'
import type React from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
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
  accessControlRender: vi.fn(),
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: ({ app }: { app: { id: string; access_mode: string } }) => {
    mocks.accessControlRender(app)
    return <div role="dialog" aria-label="access-control" />
  },
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

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    currentWorkspace: { id: 'workspace-1' },
    workspacePermissionKeys: ['app.acl.edit'],
    langGeniusVersionInfo: {
      current_env: 'PRODUCTION',
      current_version: '',
      latest_version: '',
      version: '',
      release_notes: '',
    },
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-1' },
    currentWorkspace: { id: 'workspace-1' },
    workspacePermissionKeys: ['app.acl.edit'],
    langGeniusVersionInfo: {
      current_env: 'PRODUCTION',
      current_version: '',
      latest_version: '',
      version: '',
      release_notes: '',
    },
  }))
})
vi.mock('@/service/client', () => ({
  consoleQuery: {
    account: {
      profile: {
        get: {
          queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
        },
      },
    },
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['system-features'],
          ...options,
        }),
      },
    },
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
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
            'agent-detail',
            input.params.agent_id,
          ],
        },
        apiAccess: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
              'agent-api-access',
              input.params.agent_id,
            ],
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
    access_ready: true,
    enable_api: true,
    enable_site: true,
    icon_url: null,
    id: 'agent-1',
    mode: 'agent',
    name: 'Support Agent',
    app_id: 'app-1',
    backing_app_id: 'app-1',
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

function createAppDetailResponse(overrides: Partial<AppDetail> = {}): AppDetail {
  return {
    enable_api: true,
    enable_site: true,
    id: 'app-1',
    mode: 'agent',
    name: 'Support Agent',
    ...overrides,
  }
}

function createAgentApiAccessResponse(
  overrides: Partial<AgentApiAccessResponse> = {},
): AgentApiAccessResponse {
  const serviceApiBaseUrl = 'https://api.example.test/v1'

  return {
    access_ready: true,
    api_key_count: 2,
    api_rph: 0,
    api_rpm: 0,
    chat_endpoint: `${serviceApiBaseUrl}/chat-messages`,
    conversations_endpoint: `${serviceApiBaseUrl}/conversations`,
    enabled: true,
    files_upload_endpoint: `${serviceApiBaseUrl}/files/upload`,
    info_endpoint: `${serviceApiBaseUrl}/info`,
    messages_endpoint: `${serviceApiBaseUrl}/messages`,
    meta_endpoint: `${serviceApiBaseUrl}/meta`,
    parameters_endpoint: `${serviceApiBaseUrl}/parameters`,
    service_api_base_url: serviceApiBaseUrl,
    stop_endpoint: `${serviceApiBaseUrl}/chat-messages/{task_id}/stop`,
    streaming_only: true,
    ...overrides,
  }
}

function renderWithQueryClient(
  ui: React.ReactElement,
  { webAppAuthEnabled = true }: { webAppAuthEnabled?: boolean } = {},
) {
  const queryClient = createConsoleQueryClient(webAppAuthEnabled)

  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)

  return queryClient
}

function createConsoleQueryClient(webAppAuthEnabled = true) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  seedSystemFeatures(queryClient, {
    webapp_auth: {
      enabled: webAppAuthEnabled,
    },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  return queryClient
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe('Agent access surface cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Web app access', () => {
    it('should serialize Web App toggles and cache each confirmed response', async () => {
      const user = userEvent.setup()
      const firstToggle = createDeferredPromise<AppDetail>()
      const secondToggle = createDeferredPromise<AppDetail>()
      mocks.siteEnableMutation
        .mockReturnValueOnce(firstToggle.promise)
        .mockReturnValueOnce(secondToggle.promise)

      const agent = createAgent()
      const queryClient = renderWithQueryClient(
        <WebAppAccessCard agent={agent} agentId="agent-1" isLoading={false} />,
      )
      queryClient.setQueryData(['agent-detail', 'agent-1'], agent)

      expect(screen.getByText('https://chat.example.test/agent/site-token')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'agentV2.agentDetail.access.webApp.actions.launch' }),
      ).toHaveAttribute('href', 'https://chat.example.test/agent/site-token')
      expect(screen.getByText('agentV2.agentDetail.access.webApp.ssoEnabled')).toBeInTheDocument()

      const accessSwitch = screen.getByRole('switch', {
        name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.webApp.title"}',
      })
      await user.click(accessSwitch)

      expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
      expect(accessSwitch).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.launch' }),
      ).toBeDisabled()
      expect(mocks.siteEnableMutation.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
        },
        body: {
          enable_site: false,
        },
      })

      await user.click(accessSwitch)

      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.launch' }),
      ).toBeDisabled()
      expect(mocks.siteEnableMutation).toHaveBeenCalledTimes(1)

      firstToggle.resolve(
        createAppDetailResponse({
          enable_site: false,
          updated_at: 1781660200,
          updated_by: 'user-2',
        }),
      )

      await waitFor(() => {
        expect(mocks.siteEnableMutation.mock.calls[1]?.[0]).toEqual({
          params: {
            app_id: 'app-1',
          },
          body: {
            enable_site: true,
          },
        })
      })
      expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toMatchObject({
        enable_site: false,
        updated_at: 1781660200,
        updated_by: 'user-2',
      })

      secondToggle.resolve(
        createAppDetailResponse({
          enable_site: true,
          updated_at: 1781660300,
          updated_by: 'user-3',
        }),
      )

      await waitFor(() => {
        expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toMatchObject({
          enable_site: true,
          updated_at: 1781660300,
          updated_by: 'user-3',
        })
      })
      expect(
        await screen.findByRole('link', {
          name: 'agentV2.agentDetail.access.webApp.actions.launch',
        }),
      ).toHaveAttribute('href', 'https://chat.example.test/agent/site-token')
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should keep launch disabled while enabling is pending and roll back after failure', async () => {
      const user = userEvent.setup()
      const toggle = createDeferredPromise<AppDetail>()
      mocks.siteEnableMutation.mockReturnValueOnce(toggle.promise)

      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({ enable_site: false })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      const accessSwitch = screen.getByRole('switch', {
        name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.webApp.title"}',
      })
      const launchButton = screen.getByRole('button', {
        name: 'agentV2.agentDetail.access.webApp.actions.launch',
      })
      await user.click(accessSwitch)

      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
      expect(accessSwitch).toBeEnabled()
      expect(launchButton).toBeDisabled()
      expect(
        screen.queryByRole('link', { name: 'agentV2.agentDetail.access.webApp.actions.launch' }),
      ).not.toBeInTheDocument()

      toggle.reject(new Error('request failed'))

      await waitFor(() => {
        expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
      })
      expect(launchButton).toBeDisabled()
      expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })

    it('should open the customize dialog with the backing app id and API base URL', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.customize' }),
      )

      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.customize.title',
      })
      expect(dialog).toHaveTextContent(/NEXT_PUBLIC_APP_ID=\s*'app-1'/)
      expect(dialog).toHaveTextContent(/NEXT_PUBLIC_API_URL=\s*'https:\/\/api\.example\.test\/v1'/)
      expect(
        within(dialog).getByRole('button', {
          name: /appOverview\.overview\.appInfo\.customize\.way1\.step1Operation/,
        }),
      ).toHaveAttribute('href', 'https://github.com/langgenius/webapp-conversation')
    })

    it('should open the embedded dialog with the Agent web app route', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' }),
      )

      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.embedded.title',
      })
      await waitFor(() => {
        expect(dialog).toHaveTextContent('https://chat.example.test/agent/site-token')
      })

      await user.click(
        within(dialog).getByRole('button', {
          name: 'appOverview.overview.appInfo.embedded.scripts',
        }),
      )

      await waitFor(() => {
        expect(dialog).toHaveTextContent("routeSegment: 'agent'")
      })
    })

    it('should close the embedded dialog from the close button', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.embedded.title',
      })

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'appOverview.overview.appInfo.embedded.title' }),
        ).not.toBeInTheDocument()
      })
    })

    it('should save settings through the backing app id and update the agent detail cache', async () => {
      const user = userEvent.setup()
      const agent = createAgent({
        site: {
          ...createAgent().site!,
          icon_url: 'https://files.example.test/old-icon.png',
        },
      })
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

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.settings.title',
      })

      await user.clear(within(dialog).getByPlaceholderText('app.appNamePlaceholder'))
      await user.type(
        within(dialog).getByPlaceholderText('app.appNamePlaceholder'),
        'Support Portal',
      )
      await user.clear(
        within(dialog).getByRole('textbox', {
          name: 'appOverview.overview.appInfo.settings.webDesc',
        }),
      )
      await user.type(
        within(dialog).getByRole('textbox', {
          name: 'appOverview.overview.appInfo.settings.webDesc',
        }),
        'Updated web description.',
      )
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
      expect(
        queryClient.getQueryData<AgentAppDetailWithSite>(['agent-detail', 'agent-1']),
      ).toMatchObject({
        site: {
          access_token: 'new-site-token',
          chat_color_theme: '#123456',
          description: 'Updated web description.',
          icon_url: null,
          title: 'Support Portal',
        },
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['agent-detail', 'agent-1'] })
    })

    it('should fall back to the Agent icon tuple when WebApp site icon data is missing', async () => {
      const user = userEvent.setup()
      const agent = createAgent({
        icon: 'agent-image-file-id',
        icon_background: null,
        icon_type: 'image',
        icon_url: 'https://files.example.test/agent-icon.png',
        site: {
          ...createAgent().site!,
          icon: null,
          icon_background: null,
          icon_type: null,
          icon_url: null,
        },
      })
      mocks.siteMutation.mockResolvedValueOnce({
        app_id: 'app-1',
        code: 'site-token',
        copyright: '',
        custom_disclaimer: '',
        customize_domain: null,
        customize_token_strategy: 'allow',
        default_language: 'en-US',
        description: 'Support Agent',
        icon: 'agent-image-file-id',
        icon_background: null,
        privacy_policy: '',
        prompt_public: false,
        show_workflow_steps: false,
        title: 'Support Agent',
        use_icon_as_answer_icon: false,
      })

      renderWithQueryClient(<WebAppAccessCard agent={agent} agentId="agent-1" isLoading={false} />)

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.settings.title',
      })
      expect(within(dialog).getByAltText('app icon')).toHaveAttribute(
        'src',
        'https://files.example.test/agent-icon.png',
      )

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mocks.siteMutation.mock.calls[0]?.[0].body).toEqual(
          expect.objectContaining({
            icon: 'agent-image-file-id',
            icon_background: undefined,
            icon_type: 'image',
          }),
        )
      })
    })

    it('should not show the multi-environment settings notice', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard agent={createAgent()} agentId="agent-1" isLoading={false} />,
      )

      await user.click(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }),
      )

      const dialog = await screen.findByRole('dialog', {
        name: 'appOverview.overview.appInfo.settings.title',
      })
      expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
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

      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.embedded' }),
      ).toBeDisabled()
    })

    it('should keep settings disabled until the backing app id and site data are available', () => {
      const agentWithoutApp = createAgent({
        app_id: null,
      })
      const agentWithoutSite = createAgent({
        site: null,
      })
      const queryClient = createConsoleQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <WebAppAccessCard agent={agentWithoutApp} agentId="agent-1" isLoading={false} />
        </QueryClientProvider>,
      )

      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }),
      ).toBeDisabled()

      rerender(
        <QueryClientProvider client={queryClient}>
          <WebAppAccessCard agent={agentWithoutSite} agentId="agent-1" isLoading={false} />
        </QueryClientProvider>,
      )

      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.settings' }),
      ).toBeDisabled()
    })

    it('should keep customize disabled until the generated contract provides the required fields', () => {
      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({ api_base_url: null })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.access.webApp.actions.customize' }),
      ).toBeDisabled()
    })

    it('should explain that publishing enables the Web App switch and launch action', async () => {
      const user = userEvent.setup()
      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({ access_ready: false, enable_site: false })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      const accessSwitch = screen.getByRole('switch', {
        name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.webApp.title"}',
      })
      expect(accessSwitch).toHaveAttribute('aria-disabled', 'true')

      await user.tab()
      expect(accessSwitch).toHaveFocus()
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'agentV2.agentDetail.access.publishRequired',
      )

      await user.tab()
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      })

      await user.hover(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.access.webApp.actions.launch',
        }),
      )
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'agentV2.agentDetail.access.publishRequired',
      )
    })
  })

  describe('Service API access', () => {
    it('should render service API data and toggle Agent API status through the generated Agent endpoint', async () => {
      const user = userEvent.setup()
      const toggle = createDeferredPromise<AgentApiAccessResponse>()
      mocks.apiAccessQueryFn.mockResolvedValueOnce(createAgentApiAccessResponse())
      mocks.apiEnableMutation.mockReturnValueOnce(toggle.promise)

      renderWithQueryClient(<ServiceApiAccessCard agentId="agent-1" />)

      expect(await screen.findByText('https://api.example.test/v1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()

      const accessSwitch = screen.getByRole('switch', {
        name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.serviceApi.title"}',
      })
      const apiKeyButton = screen.getByRole('button', {
        name: /agentV2\.agentDetail\.access\.serviceApi\.actions\.apiKey/,
      })
      await user.click(accessSwitch)

      expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
      expect(accessSwitch).toBeEnabled()
      expect(apiKeyButton).toBeEnabled()
      expect(mocks.apiEnableMutation.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          enable_api: false,
        },
      })

      toggle.reject(new Error('request failed'))

      await waitFor(() => {
        expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
      })
      expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should keep raw API enablement separate from effective API access status', async () => {
      const user = userEvent.setup()
      const initialApiAccess = createAgentApiAccessResponse({ enabled: false })
      const updatedApiAccess = createAgentApiAccessResponse({ access_ready: false, enabled: false })
      mocks.apiAccessQueryFn.mockResolvedValueOnce(initialApiAccess)
      mocks.apiEnableMutation.mockResolvedValueOnce(updatedApiAccess)

      const agent = createAgent({ enable_api: false })
      const queryClient = renderWithQueryClient(<ServiceApiAccessCard agentId="agent-1" />)
      queryClient.setQueryData(['agent-detail', 'agent-1'], agent)

      await screen.findByText(initialApiAccess.service_api_base_url)
      await user.click(
        screen.getByRole('switch', {
          name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.serviceApi.title"}',
        }),
      )

      await waitFor(() => {
        expect(queryClient.getQueryData(['agent-api-access', 'agent-1'])).toEqual(updatedApiAccess)
        expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toMatchObject({
          enable_api: true,
        })
      })
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should manage API keys with the Agent API key endpoints', async () => {
      const user = userEvent.setup()
      mocks.apiAccessQueryFn.mockResolvedValue(createAgentApiAccessResponse({ api_key_count: 1 }))
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

      await user.click(
        await screen.findByRole('button', {
          name: /agentV2\.agentDetail\.access\.serviceApi\.actions\.apiKey/,
        }),
      )

      const dialog = await screen.findByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' })
      expect(await within(dialog).findByText('app...ing-secret-key-token')).toBeInTheDocument()

      await user.click(
        within(dialog).getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
      )

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

    it('should explain that publishing enables the Service API switch', async () => {
      const user = userEvent.setup()
      mocks.apiAccessQueryFn.mockResolvedValueOnce(
        createAgentApiAccessResponse({
          access_ready: false,
          api_key_count: 0,
          enabled: false,
        }),
      )

      renderWithQueryClient(<ServiceApiAccessCard agentId="agent-1" />)

      await screen.findByText('https://api.example.test/v1')
      const accessSwitch = screen.getByRole('switch', {
        name: 'agentV2.agentDetail.access.toggleSurface:{"name":"agentV2.agentDetail.access.serviceApi.title"}',
      })
      expect(accessSwitch).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('button', {
          name: /agentV2\.agentDetail\.access\.serviceApi\.actions\.apiKey/,
        }),
      ).toBeDisabled()

      await user.tab()
      expect(accessSwitch).toHaveFocus()
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'agentV2.agentDetail.access.publishRequired',
      )
    })
  })

  describe('Web app access control', () => {
    const accessControlAgent = () =>
      createAgent({
        access_mode: 'private',
        maintainer: 'user-1',
        permission_keys: ['app.acl.release_and_version'],
      })

    const accessControlButtonName = 'agentV2.agentDetail.access.webApp.actions.accessControl'

    it('should render the access control button when webapp auth is enabled and user can manage', () => {
      renderWithQueryClient(
        <WebAppAccessCard agent={accessControlAgent()} agentId="agent-1" isLoading={false} />,
      )

      expect(screen.getByRole('button', { name: accessControlButtonName })).toBeInTheDocument()
    })

    it('should hide the access control button when webapp auth is disabled', () => {
      renderWithQueryClient(
        <WebAppAccessCard agent={accessControlAgent()} agentId="agent-1" isLoading={false} />,
        { webAppAuthEnabled: false },
      )

      expect(
        screen.queryByRole('button', { name: accessControlButtonName }),
      ).not.toBeInTheDocument()
    })

    it('should hide the access control button when the user cannot manage access control', () => {
      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({ access_mode: 'private', permission_keys: [] })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      expect(
        screen.queryByRole('button', { name: accessControlButtonName }),
      ).not.toBeInTheDocument()
    })

    it.each([null, 'future-access-mode'])(
      'should hide the access control button when the access mode is %s',
      (accessMode) => {
        renderWithQueryClient(
          <WebAppAccessCard
            agent={createAgent({
              access_mode: accessMode,
              maintainer: 'user-1',
              permission_keys: ['app.acl.release_and_version'],
            })}
            agentId="agent-1"
            isLoading={false}
          />,
        )

        expect(
          screen.queryByRole('button', { name: accessControlButtonName }),
        ).not.toBeInTheDocument()
      },
    )

    it('should open the access control dialog wired with the backing app id', async () => {
      const user = userEvent.setup()

      renderWithQueryClient(
        <WebAppAccessCard
          agent={createAgent({
            access_mode: 'private',
            app_id: 'source-app-1',
            backing_app_id: 'backing-app-1',
            maintainer: 'user-1',
            permission_keys: ['app.acl.release_and_version'],
          })}
          agentId="agent-1"
          isLoading={false}
        />,
      )

      await user.click(screen.getByRole('button', { name: accessControlButtonName }))

      expect(screen.getByRole('dialog', { name: 'access-control' })).toBeInTheDocument()
      expect(mocks.accessControlRender).toHaveBeenCalledWith({
        id: 'backing-app-1',
        access_mode: 'private',
      })
    })
  })
})
