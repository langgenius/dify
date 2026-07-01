import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useAllTriggerPlugins,
  useBuildTriggerSubscription,
  useConfigureTriggerOAuth,
  useCreateTriggerSubscriptionBuilder,
  useDeleteTriggerOAuth,
  useDeleteTriggerSubscription,
  useInitiateTriggerOAuth,
  useInvalidateAllTriggerPlugins,
  useTriggerOAuthConfig,
  useTriggerProviderInfo,
  useTriggerSubscriptionBuilderLogs,
  useTriggerSubscriptions,
  useUpdateTriggerSubscription,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyAndUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscription,
} from '../use-triggers'

const {
  mockAuthorizeOAuth,
  mockBuildBuilder,
  mockConfigureOAuth,
  mockCreateBuilder,
  mockDeleteOAuth,
  mockDeleteSubscription,
  mockGetBuilderLogs,
  mockGetOAuthConfig,
  mockGetProviderInfo,
  mockGetSubscriptions,
  mockGetTriggers,
  mockInvalid,
  mockUpdateBuilder,
  mockUpdateSubscription,
  mockUseInvalid,
  mockVerifyAndUpdateBuilder,
  mockVerifySubscription,
} = vi.hoisted(() => ({
  mockAuthorizeOAuth: vi.fn(),
  mockBuildBuilder: vi.fn(),
  mockConfigureOAuth: vi.fn(),
  mockCreateBuilder: vi.fn(),
  mockDeleteOAuth: vi.fn(),
  mockDeleteSubscription: vi.fn(),
  mockGetBuilderLogs: vi.fn(),
  mockGetOAuthConfig: vi.fn(),
  mockGetProviderInfo: vi.fn(),
  mockGetSubscriptions: vi.fn(),
  mockGetTriggers: vi.fn(),
  mockInvalid: vi.fn(),
  mockUpdateBuilder: vi.fn(),
  mockUpdateSubscription: vi.fn(),
  mockUseInvalid: vi.fn(() => mockInvalid),
  mockVerifyAndUpdateBuilder: vi.fn(),
  mockVerifySubscription: vi.fn(),
}))

vi.mock('../use-base', () => ({
  useInvalid: mockUseInvalid,
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        triggers: {
          get: mockGetTriggers,
        },
        triggerProvider: {
          byProvider: {
            info: {
              get: mockGetProviderInfo,
            },
            subscriptions: {
              builder: {
                build: {
                  bySubscriptionBuilderId: {
                    post: mockBuildBuilder,
                  },
                },
                create: {
                  post: mockCreateBuilder,
                },
                logs: {
                  bySubscriptionBuilderId: {
                    get: mockGetBuilderLogs,
                  },
                },
                update: {
                  bySubscriptionBuilderId: {
                    post: mockUpdateBuilder,
                  },
                },
                verifyAndUpdate: {
                  bySubscriptionBuilderId: {
                    post: mockVerifyAndUpdateBuilder,
                  },
                },
              },
              list: {
                get: mockGetSubscriptions,
              },
              oauth: {
                authorize: {
                  get: mockAuthorizeOAuth,
                },
              },
              verify: {
                bySubscriptionId: {
                  post: mockVerifySubscription,
                },
              },
            },
            oauth: {
              client: {
                delete: mockDeleteOAuth,
                get: mockGetOAuthConfig,
                post: mockConfigureOAuth,
              },
            },
          },
          bySubscriptionId: {
            subscriptions: {
              delete: {
                post: mockDeleteSubscription,
              },
              update: {
                post: mockUpdateSubscription,
              },
            },
          },
        },
      },
    },
  },
  consoleQuery: (() => {
    const queryKey = (key: string) => ({ queryKey: (input?: unknown) => [key, input] })
    const mutationKey = (key: string) => ({ mutationKey: () => [key] })

    return {
      workspaces: {
        current: {
          triggers: {
            get: queryKey('triggers.get'),
          },
          triggerProvider: {
            byProvider: {
              info: {
                get: queryKey('trigger-provider.info.get'),
              },
              oauth: {
                client: {
                  delete: mutationKey('trigger-provider.oauth.client.delete'),
                  get: queryKey('trigger-provider.oauth.client.get'),
                  post: mutationKey('trigger-provider.oauth.client.post'),
                },
              },
              subscriptions: {
                builder: {
                  build: {
                    bySubscriptionBuilderId: {
                      post: mutationKey('trigger-provider.subscriptions.builder.build.post'),
                    },
                  },
                  create: {
                    post: mutationKey('trigger-provider.subscriptions.builder.create.post'),
                  },
                  logs: {
                    bySubscriptionBuilderId: {
                      get: queryKey('trigger-provider.subscriptions.builder.logs.get'),
                    },
                  },
                  update: {
                    bySubscriptionBuilderId: {
                      post: mutationKey('trigger-provider.subscriptions.builder.update.post'),
                    },
                  },
                  verifyAndUpdate: {
                    bySubscriptionBuilderId: {
                      post: mutationKey('trigger-provider.subscriptions.builder.verify-and-update.post'),
                    },
                  },
                },
                list: {
                  get: queryKey('trigger-provider.subscriptions.list.get'),
                },
                oauth: {
                  authorize: {
                    get: mutationKey('trigger-provider.subscriptions.oauth.authorize.get'),
                  },
                },
                verify: {
                  bySubscriptionId: {
                    post: mutationKey('trigger-provider.subscriptions.verify.post'),
                  },
                },
              },
            },
            bySubscriptionId: {
              subscriptions: {
                delete: {
                  post: mutationKey('trigger-provider.subscriptions.delete.post'),
                },
                update: {
                  post: mutationKey('trigger-provider.subscriptions.update.post'),
                },
              },
            },
          },
        },
      },
    }
  })(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const triggerProvider = {
  author: 'Dify',
  description: {
    en_US: 'Starts the workflow',
    zh_Hans: 'Starts the workflow',
  },
  events: [
    {
      description: {
        en_US: 'Webhook received',
        zh_Hans: 'Webhook received',
      },
      identity: {
        author: 'Dify',
        label: {
          en_US: 'Webhook received',
          zh_Hans: 'Webhook received',
        },
        name: 'webhook.received',
      },
      name: 'webhook.received',
      output_schema: { type: 'object' },
      parameters: [
        {
          default: 'topic',
          description: {
            en_US: 'Topic',
            zh_Hans: 'Topic',
          },
          label: {
            en_US: 'Topic',
            zh_Hans: 'Topic',
          },
          multiple: true,
          name: 'topic',
          options: [
            {
              label: {
                en_US: 'News',
                zh_Hans: 'News',
              },
              value: 'news',
            },
          ],
          required: true,
          type: 'select',
        },
      ],
    },
  ],
  icon: '/icon.svg',
  icon_dark: '/icon-dark.svg',
  label: {
    en_US: 'Webhook',
    zh_Hans: 'Webhook',
  },
  name: 'webhook',
  plugin_id: 'plugin-webhook',
  plugin_unique_identifier: 'plugin-webhook@1.0.0',
  subscription_constructor: {},
  subscription_schema: [],
  supported_creation_methods: ['MANUAL'],
  tags: ['automation'],
}

const subscriptionBuilder = {
  credential_type: 'oauth2',
  credentials: {},
  endpoint: 'https://example.com/endpoint',
  id: 'builder-1',
  name: 'Builder',
  parameters: {},
  properties: {},
  provider: 'provider-a',
}

const triggerSubscription = {
  ...subscriptionBuilder,
  id: 'sub-1',
  workflows_in_use: 0,
}

const triggerLog = {
  created_at: '2026-01-01T00:00:00Z',
  endpoint: 'https://example.com/endpoint',
  id: 'log-1',
  request: {
    data: '{}',
    headers: {
      Host: 'example.com',
    },
    method: 'POST',
    url: 'https://example.com/endpoint',
  },
  response: {
    data: '{}',
    headers: {
      'Content-Type': 'application/json',
    },
    status_code: 200,
  },
}

const oauthConfig = {
  configured: true,
  custom_configured: true,
  custom_enabled: true,
  oauth_client_schema: [],
  params: {
    client_id: 'client-id',
    client_secret: 'client-secret',
  },
  redirect_uri: 'https://example.com/oauth/callback',
  system_configured: false,
}

describe('use-triggers generated client hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch trigger plugins and normalize provider data', async () => {
    mockGetTriggers.mockResolvedValue([triggerProvider])

    const { result } = renderHook(() => useAllTriggerPlugins(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.data?.[0]?.id).toBe('plugin-webhook')
    })
    expect(mockGetTriggers).toHaveBeenCalledWith({})
    expect(result.current.data?.[0]?.events[0]?.parameters[0]).toMatchObject({
      default: 'topic',
      form: 'select',
      multiple: true,
      name: 'topic',
      required: true,
    })
  })

  it('should invalidate the generated trigger plugin query key', () => {
    renderHook(() => useInvalidateAllTriggerPlugins(), { wrapper: createWrapper() })

    expect(mockUseInvalid).toHaveBeenCalledWith(['triggers.get', { input: {} }])
  })

  it('should fetch provider info, subscriptions, logs, and OAuth config with provider params', async () => {
    mockGetProviderInfo.mockResolvedValue(triggerProvider)
    mockGetSubscriptions.mockResolvedValue([triggerSubscription])
    mockGetBuilderLogs.mockResolvedValue({ logs: [triggerLog] })
    mockGetOAuthConfig.mockResolvedValue(oauthConfig)

    renderHook(() => useTriggerProviderInfo('provider-a'), { wrapper: createWrapper() })
    renderHook(() => useTriggerSubscriptions('provider-a'), { wrapper: createWrapper() })
    renderHook(() => useTriggerSubscriptionBuilderLogs('provider-a', 'builder-1'), { wrapper: createWrapper() })
    renderHook(() => useTriggerOAuthConfig('provider-a'), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mockGetOAuthConfig).toHaveBeenCalled()
    })
    expect(mockGetProviderInfo).toHaveBeenCalledWith({ params: { provider: 'provider-a' } })
    expect(mockGetSubscriptions).toHaveBeenCalledWith({ params: { provider: 'provider-a' } })
    expect(mockGetBuilderLogs).toHaveBeenCalledWith({
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    })
    expect(mockGetOAuthConfig).toHaveBeenCalledWith({ params: { provider: 'provider-a' } })
  })

  it('should call generated subscription builder mutations with snake_case params', async () => {
    mockCreateBuilder.mockResolvedValue({ subscription_builder: subscriptionBuilder })
    mockUpdateBuilder.mockResolvedValue(subscriptionBuilder)
    mockBuildBuilder.mockResolvedValue({ id: 'sub-1' })

    const wrapper = createWrapper()
    const createMutation = renderHook(() => useCreateTriggerSubscriptionBuilder(), { wrapper })
    const updateMutation = renderHook(() => useUpdateTriggerSubscriptionBuilder(), { wrapper })
    const buildMutation = renderHook(() => useBuildTriggerSubscription(), { wrapper })

    await act(async () => {
      await createMutation.result.current.mutateAsync({ provider: 'provider-a', credential_type: 'oauth' })
      await updateMutation.result.current.mutateAsync({
        name: 'Builder',
        provider: 'provider-a',
        subscriptionBuilderId: 'builder-1',
      })
      await buildMutation.result.current.mutateAsync({
        name: 'Subscription',
        provider: 'provider-a',
        subscriptionBuilderId: 'builder-1',
      })
    })

    expect(mockCreateBuilder).toHaveBeenCalledWith({
      body: { credential_type: 'oauth' },
      params: { provider: 'provider-a' },
    })
    expect(mockUpdateBuilder).toHaveBeenCalledWith({
      body: { name: 'Builder' },
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    })
    expect(mockBuildBuilder).toHaveBeenCalledWith({
      body: { name: 'Subscription' },
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    })
  })

  it('should call generated subscription and OAuth mutations with generated params', async () => {
    mockDeleteSubscription.mockResolvedValue({})
    mockUpdateSubscription.mockResolvedValue({})
    mockConfigureOAuth.mockResolvedValue({})
    mockDeleteOAuth.mockResolvedValue({})
    mockAuthorizeOAuth.mockResolvedValue({ authorization_url: 'https://example.com', subscription_builder: subscriptionBuilder })

    const wrapper = createWrapper()
    const deleteSubscriptionMutation = renderHook(() => useDeleteTriggerSubscription(), { wrapper })
    const updateSubscriptionMutation = renderHook(() => useUpdateTriggerSubscription(), { wrapper })
    const configureOAuthMutation = renderHook(() => useConfigureTriggerOAuth(), { wrapper })
    const deleteOAuthMutation = renderHook(() => useDeleteTriggerOAuth(), { wrapper })
    const initiateOAuthMutation = renderHook(() => useInitiateTriggerOAuth(), { wrapper })

    await act(async () => {
      await deleteSubscriptionMutation.result.current.mutateAsync('sub-1')
      await updateSubscriptionMutation.result.current.mutateAsync({ name: 'Subscription', subscriptionId: 'sub-1' })
      await configureOAuthMutation.result.current.mutateAsync({
        client_params: { client_id: 'client-id', client_secret: 'client-secret' },
        enabled: true,
        provider: 'provider-a',
      })
      await deleteOAuthMutation.result.current.mutateAsync('provider-a')
      await initiateOAuthMutation.result.current.mutateAsync('provider-a')
    })

    expect(mockDeleteSubscription).toHaveBeenCalledWith({ params: { subscription_id: 'sub-1' } })
    expect(mockUpdateSubscription).toHaveBeenCalledWith({
      body: { name: 'Subscription' },
      params: { subscription_id: 'sub-1' },
    })
    expect(mockConfigureOAuth).toHaveBeenCalledWith({
      body: { client_params: { client_id: 'client-id', client_secret: 'client-secret' }, enabled: true },
      params: { provider: 'provider-a' },
    })
    expect(mockDeleteOAuth).toHaveBeenCalledWith({ params: { provider: 'provider-a' } })
    expect(mockAuthorizeOAuth).toHaveBeenCalledWith({ params: { provider: 'provider-a' } })
  })

  it('should verify trigger subscriptions through generated endpoints', async () => {
    mockVerifyAndUpdateBuilder.mockResolvedValue({ verified: true })
    mockVerifySubscription.mockResolvedValue({ verified: true })

    const wrapper = createWrapper()
    const verifyAndUpdateBuilderMutation = renderHook(() => useVerifyAndUpdateTriggerSubscriptionBuilder(), { wrapper })
    const verifySubscriptionMutation = renderHook(() => useVerifyTriggerSubscription(), { wrapper })

    await act(async () => {
      await verifyAndUpdateBuilderMutation.result.current.mutateAsync({
        credentials: { token: 'secret' },
        provider: 'provider-a',
        subscriptionBuilderId: 'builder-1',
      })
      await verifySubscriptionMutation.result.current.mutateAsync({
        credentials: { token: 'secret' },
        provider: 'provider-a',
        subscriptionId: 'sub-1',
      })
    })

    expect(mockVerifyAndUpdateBuilder).toHaveBeenCalledWith({
      body: { credentials: { token: 'secret' } },
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    })
    expect(mockVerifySubscription).toHaveBeenCalledWith({
      body: { credentials: { token: 'secret' } },
      params: { provider: 'provider-a', subscription_id: 'sub-1' },
    })
  })
})
