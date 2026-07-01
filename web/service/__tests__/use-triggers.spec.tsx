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
} from '../use-triggers'

const {
  mockBaseGet,
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
} = vi.hoisted(() => ({
  mockBaseGet: vi.fn(),
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
}))

vi.mock('../base', () => ({
  get: mockBaseGet,
  post: vi.fn(),
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
              },
              list: {
                get: mockGetSubscriptions,
              },
              oauth: {
                authorize: {
                  get: vi.fn(),
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
  description: 'Starts the workflow',
  events: [
    {
      description: 'Webhook received',
      identity: {
        label: {
          en_US: 'Webhook received',
          zh_Hans: 'Webhook received',
        },
      },
      name: 'webhook.received',
      output_schema: { type: 'object' },
      parameters: [
        {
          default: 'topic',
          description: 'Topic',
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
  subscription_schema: {},
  supported_creation_methods: ['manual'],
  tags: ['automation'],
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
    mockGetSubscriptions.mockResolvedValue([{ id: 'sub-1' }])
    mockGetBuilderLogs.mockResolvedValue({ logs: [{ message: 'ok' }] })
    mockGetOAuthConfig.mockResolvedValue({ enabled: true })

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
    mockCreateBuilder.mockResolvedValue({ subscription_builder: { id: 'builder-1' } })
    mockUpdateBuilder.mockResolvedValue({ id: 'builder-1' })
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
    mockBaseGet.mockResolvedValue({ authorization_url: 'https://example.com', subscription_builder: {} })

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
    expect(mockBaseGet).toHaveBeenCalledWith(
      '/workspaces/current/trigger-provider/provider-a/subscriptions/oauth/authorize',
      {},
      { silent: true },
    )
  })
})
