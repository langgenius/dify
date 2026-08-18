import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ComponentProps } from 'react'
import { QueryClientProvider, skipToken } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vite-plus/test'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { ApiKeyModal } from '../api-key-modal'

const apiMocks = vi.hoisted(() => ({
  appKeys: [] as AppApiKeyList['data'],
  datasetKeys: [] as DatasetApiKeyList['data'],
  environmentKeys: [] as EnvironmentApiKey[],
  listApp: vi.fn(),
  createApp: vi.fn(),
  deleteApp: vi.fn(),
  listDataset: vi.fn(),
  createDataset: vi.fn(),
  deleteDataset: vi.fn(),
  listEnvironment: vi.fn(),
  createEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byResourceId: {
        apiKeys: {
          get: {
            queryOptions: ({ input }: { input: unknown }) => ({
              queryKey: ['apps', 'api-keys', input],
              queryFn:
                input === skipToken
                  ? skipToken
                  : () => {
                      apiMocks.listApp(input)
                      return Promise.resolve({ data: apiMocks.appKeys })
                    },
            }),
          },
          post: {
            mutationOptions: () => ({
              mutationFn: (variables: unknown) => apiMocks.createApp(variables),
            }),
          },
          byApiKeyId: {
            delete: {
              mutationOptions: () => ({
                mutationFn: (variables: unknown) => apiMocks.deleteApp(variables),
              }),
            },
          },
        },
      },
    },
    datasets: {
      apiKeys: {
        get: {
          queryOptions: () => ({
            queryKey: ['datasets', 'api-keys'],
            queryFn: () => {
              apiMocks.listDataset()
              return Promise.resolve({ data: apiMocks.datasetKeys })
            },
          }),
        },
        post: {
          mutationOptions: () => ({
            mutationFn: () => apiMocks.createDataset(),
          }),
        },
        byApiKeyId: {
          delete: {
            mutationOptions: () => ({
              mutationFn: (variables: unknown) => apiMocks.deleteDataset(variables),
            }),
          },
        },
      },
    },
    enterprise: {
      appDeploy: {
        accessService: {
          listEnvironmentApiKeys: {
            queryOptions: ({ input }: { input: unknown }) => ({
              queryKey: ['environment', 'api-keys', input],
              queryFn:
                input === skipToken
                  ? skipToken
                  : () => {
                      apiMocks.listEnvironment(input)
                      return Promise.resolve({ data: apiMocks.environmentKeys })
                    },
            }),
          },
          createEnvironmentApiKey: {
            mutationOptions: () => ({
              mutationFn: (variables: unknown) => apiMocks.createEnvironment(variables),
            }),
          },
          deleteEnvironmentApiKey: {
            mutationOptions: () => ({
              mutationFn: (variables: unknown) => apiMocks.deleteEnvironment(variables),
            }),
          },
        },
      },
    },
  },
}))

const mockCurrentWorkspace = vi.fn().mockReturnValue({
  id: 'workspace-1',
  name: 'Test Workspace',
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: mockCurrentWorkspace(),
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
  }))
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `Formatted: ${value}`,
  }),
}))

const appScope = { type: 'app', appId: 'app-123' } as const
const datasetScope = { type: 'dataset' } as const
const environmentScope = {
  type: 'environment',
  appId: 'app-123',
  environmentId: 'staging',
} as const

async function renderModal(
  scope: ComponentProps<typeof ApiKeyModal>['scope'],
  overrides: { canManage?: boolean } = {},
) {
  const queryClient = createTestQueryClient()
  const onOpenChange = vi.fn()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiKeyModal
        open
        canManage={overrides.canManage ?? true}
        scope={scope}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  )
  await act(async () => {
    vi.runAllTimers()
  })
  return { ...result, onOpenChange }
}

async function confirmKeyDeletion(accessibleName: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const deleteButton = screen.getByRole('button', { name: accessibleName })
  await user.click(deleteButton)
  await act(async () => {
    vi.runAllTimers()
  })
  await user.click(await screen.findByText('common.operation.confirm'))
}

describe('ApiKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockCurrentWorkspace.mockReturnValue({ id: 'workspace-1', name: 'Test Workspace' })
    apiMocks.appKeys = []
    apiMocks.datasetKeys = []
    apiMocks.environmentKeys = []
    apiMocks.createApp.mockResolvedValue({ token: 'new-app-token-123' })
    apiMocks.deleteApp.mockResolvedValue(undefined)
    apiMocks.createDataset.mockResolvedValue({ token: 'new-dataset-token-123' })
    apiMocks.deleteDataset.mockResolvedValue(undefined)
    apiMocks.createEnvironment.mockResolvedValue({
      id: 'environment-key-2',
      token: 'env-created-secret-key-abcdefghijklmnopqrst',
      type: 'api',
      created_at: 1,
    })
    apiMocks.deleteEnvironment.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads and renders app API keys through the generated query input', async () => {
    apiMocks.appKeys = [
      {
        id: 'app-key-1',
        token: 'app-secret-token-123456789',
        type: 'app',
        created_at: 1,
      },
    ]

    await renderModal(appScope)

    expect(await screen.findByText('app...cret-token-123456789')).toBeInTheDocument()
    expect(apiMocks.listApp).toHaveBeenCalledWith({
      params: { resource_id: 'app-123' },
    })
  })

  it('loads and renders workspace dataset API keys', async () => {
    apiMocks.datasetKeys = [
      {
        id: 'dataset-key-1',
        token: 'dataset-secret-token-123456789',
        type: 'dataset',
        created_at: 1,
      },
    ]

    await renderModal(datasetScope)

    expect(await screen.findByText('dat...cret-token-123456789')).toBeInTheDocument()
    expect(apiMocks.listDataset).toHaveBeenCalled()
  })

  it('creates an app API key through the generated mutation input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal(appScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    await waitFor(() => {
      expect(apiMocks.createApp).toHaveBeenCalledWith({
        params: { resource_id: 'app-123' },
      })
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-app-token-123')
  })

  it('creates a dataset API key through the generated mutation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal(datasetScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    await waitFor(() => {
      expect(apiMocks.createDataset).toHaveBeenCalledWith()
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-dataset-token-123')
  })

  it('deletes an app API key through the generated mutation input', async () => {
    apiMocks.appKeys = [
      {
        id: 'app-key-0',
        token: 'other-app-secret-token-987654321',
        type: 'app',
        created_at: 1,
      },
      {
        id: 'app-key-1',
        token: 'app-secret-token-123456789',
        type: 'app',
        created_at: 1,
      },
    ]
    await renderModal(appScope)
    await screen.findByText('app...cret-token-123456789')

    await confirmKeyDeletion('common.operation.delete app...cret-token-123456789')

    await waitFor(() => {
      expect(apiMocks.deleteApp).toHaveBeenCalledWith({
        params: { resource_id: 'app-123', api_key_id: 'app-key-1' },
      })
    })
  })

  it('deletes a dataset API key through the generated mutation input', async () => {
    apiMocks.datasetKeys = [
      {
        id: 'dataset-key-0',
        token: 'other-dataset-secret-token-987654321',
        type: 'dataset',
        created_at: 1,
      },
      {
        id: 'dataset-key-1',
        token: 'dataset-secret-token-123456789',
        type: 'dataset',
        created_at: 1,
      },
    ]
    await renderModal(datasetScope)
    await screen.findByText('dat...cret-token-123456789')

    await confirmKeyDeletion('common.operation.delete dat...cret-token-123456789')

    await waitFor(() => {
      expect(apiMocks.deleteDataset).toHaveBeenCalledWith({
        params: { api_key_id: 'dataset-key-1' },
      })
    })
  })

  it('loads environment-scoped keys without requesting built-in app keys', async () => {
    apiMocks.environmentKeys = [
      {
        id: 'environment-key-1',
        token: 'env-existing-secret-key-abcdefghijklmnopqrst',
        type: 'api',
        created_at: 1,
      },
    ]

    await renderModal(environmentScope)

    expect(await screen.findByText(/^env\.\.\./)).toBeInTheDocument()
    expect(apiMocks.listEnvironment).toHaveBeenCalledWith({
      params: {
        app_id: 'app-123',
        environment_id: 'staging',
      },
    })
    expect(apiMocks.listApp).not.toHaveBeenCalled()
  })

  it('creates an environment-scoped API key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal(environmentScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    await waitFor(() => {
      expect(apiMocks.createEnvironment).toHaveBeenCalledWith({
        params: {
          app_id: 'app-123',
          environment_id: 'staging',
        },
      })
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('env-created-secret-key-abcdefghijklmnopqrst')
  })

  it('deletes an environment-scoped API key', async () => {
    apiMocks.environmentKeys = [
      {
        id: 'environment-key-1',
        token: 'env-existing-secret-key-abcdefghijklmnopqrst',
        type: 'api',
        created_at: 1,
      },
    ]
    await renderModal(environmentScope)

    await screen.findByText(/^env\.\.\./)
    await confirmKeyDeletion('common.operation.delete env...abcdefghijklmnopqrst')

    await waitFor(() => {
      expect(apiMocks.deleteEnvironment).toHaveBeenCalledWith({
        params: {
          api_key_id: 'environment-key-1',
          app_id: 'app-123',
          environment_id: 'staging',
        },
      })
    })
  })

  it('disables creation when the caller cannot manage keys', async () => {
    await renderModal(datasetScope, { canManage: false })

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.createNewSecretKey',
      }),
    ).toBeDisabled()
  })

  it('exposes an accessible close button', async () => {
    const { onOpenChange } = await renderModal(datasetScope)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
