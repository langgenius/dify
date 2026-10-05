import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ComponentProps } from 'react'
import { QueryClientProvider, skipToken } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('@/service/console', () => ({
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
            mutationFn: (variables: unknown) => apiMocks.createDataset(variables),
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

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: ({ keyword = '' }: { keyword?: string }) => ({
    data: {
      pages: [
        {
          data: [
            { id: 'engineering', name: 'Engineering' },
            { id: 'support', name: 'Support' },
          ].filter((dataset) => dataset.name.toLowerCase().includes(keyword.toLowerCase())),
        },
      ],
    },
  }),
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

function createPendingRequest<T>() {
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

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
  const deleteButton = await screen.findByRole('button', { name: accessibleName })
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
    // Dataset keys surface their knowledge-base scope; a key without dataset_ids reads
    // as scoped to all knowledge bases.
    expect(
      screen.getByRole('columnheader', { name: 'appApi.apiKeyModal.scope' }),
    ).toBeInTheDocument()
    expect(screen.getByText('appApi.apiKeyModal.scopeAllDatasets')).toBeInTheDocument()
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

  it('creates a workspace dataset API key scoped to all knowledge bases', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal(datasetScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    // Dataset creation first opens the scope dialog; the default "all" scope creates a
    // key with an empty dataset_ids list.
    await user.click(await screen.findByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(apiMocks.createDataset).toHaveBeenCalledWith({ body: { dataset_ids: [] } })
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

  it('searches for a knowledge base and creates a key scoped to the selection', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal(datasetScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))
    await user.click(await screen.findByRole('radio', { name: /scopeSpecificDatasets/ }))
    expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    await user.click(screen.getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }))
    await user.type(
      await screen.findByRole('combobox', { name: 'appApi.apiKeyModal.searchKnowledgeBases' }),
      'engineering',
    )

    expect(screen.queryByRole('option', { name: 'Support' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Engineering' }))
    expect(screen.getByRole('option', { name: 'Engineering' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.getByRole('combobox', { name: 'appApi.apiKeyModal.searchKnowledgeBases' }),
    ).toHaveValue('engineering')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(apiMocks.createDataset).toHaveBeenCalledWith({
        body: { dataset_ids: ['engineering'] },
      })
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-dataset-token-123')
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
  it('blocks dismissal and duplicate creation while pending, then allows retry after failure', async () => {
    apiMocks.appKeys = [
      { id: 'app-key-1', token: 'app-secret-token-123456789', type: 'app', created_at: 1 },
    ]
    const pending = createPendingRequest<{ token: string }>()
    apiMocks.createApp.mockReturnValueOnce(pending.promise)
    const { onOpenChange } = await renderModal(appScope)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const create = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
    await user.click(create)
    await waitFor(() => expect(create).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /common.operation.delete/ })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(create)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(apiMocks.createApp).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('Creation failed')))
    await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(create)
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-app-token-123')
    expect(apiMocks.createApp).toHaveBeenCalledTimes(2)
  })

  it('keeps deletion confirmation pending and failed, and closes it only after successful retry', async () => {
    apiMocks.appKeys = [
      { id: 'app-key-1', token: 'app-secret-token-123456789', type: 'app', created_at: 1 },
    ]
    const pending = createPendingRequest<void>()
    apiMocks.deleteApp.mockReturnValueOnce(pending.promise)
    const { onOpenChange } = await renderModal(appScope)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const deleteButton = await screen.findByRole('button', {
      name: 'common.operation.delete app...cret-token-123456789',
    })
    await user.click(deleteButton)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(deleteButton).toHaveFocus())
    await confirmKeyDeletion('common.operation.delete app...cret-token-123456789')
    const confirmation = screen.getByRole('alertdialog')
    const confirm = within(confirmation).getByRole('button', { name: 'common.operation.confirm' })
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    expect(
      within(confirmation).getByRole('button', { name: 'common.operation.cancel' }),
    ).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(confirm)
    expect(confirmation).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(apiMocks.deleteApp).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('Deletion failed')))
    await waitFor(() => expect(confirm).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(confirm)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMocks.deleteApp).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'appApi.apiKeyModal.createNewSecretKey',
        }),
      ).toHaveFocus(),
    )
  })

  it('resets the scope selection after cancellation', async () => {
    await renderModal(datasetScope)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const openScope = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
    await user.click(openScope)
    const scope = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' })
    await user.click(within(scope).getByRole('radio', { name: /scopeSpecificDatasets/ }))
    await user.click(
      within(scope).getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }),
    )
    await user.click(await screen.findByRole('option', { name: 'Engineering' }))
    await user.keyboard('{Escape}')
    await user.click(within(scope).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' }),
      ).not.toBeInTheDocument(),
    )
    await user.click(openScope)
    const reopened = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' })
    expect(within(reopened).getByRole('radio', { name: /scopeAllDatasets/ })).toBeChecked()
    await user.click(within(reopened).getByRole('radio', { name: /scopeSpecificDatasets/ }))
    expect(
      within(reopened).getByText('appApi.apiKeyModal.noKnowledgeBasesSelected'),
    ).toBeInTheDocument()
    expect(within(reopened).getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
  })

  it('freezes scope while creating and retries the same selection after failure', async () => {
    const pending = createPendingRequest<{ token: string }>()
    apiMocks.createDataset.mockReturnValueOnce(pending.promise)
    const { onOpenChange } = await renderModal(datasetScope)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))
    const scope = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' })
    await user.click(within(scope).getByRole('radio', { name: /scopeSpecificDatasets/ }))
    await user.click(
      within(scope).getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }),
    )
    await user.click(await screen.findByRole('option', { name: 'Engineering' }))
    await user.keyboard('{Escape}')
    const create = within(scope).getByRole('button', { name: 'common.operation.create' })
    await user.click(create)
    await waitFor(() => expect(create).toHaveAttribute('aria-disabled', 'true'))
    expect(within(scope).getByRole('radio', { name: /scopeAllDatasets/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    for (const name of [
      'common.operation.remove',
      'common.operation.close',
      'common.operation.cancel',
    ])
      expect(within(scope).getByRole('button', { name })).toBeDisabled()
    expect(
      within(scope).getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }),
    ).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(create)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(apiMocks.createDataset).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('Creation failed')))
    await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled', 'true'))
    expect(within(scope).getByText('Engineering')).toBeInTheDocument()
    await user.click(create)
    await waitFor(() => expect(apiMocks.createDataset).toHaveBeenCalledTimes(2))
    expect(apiMocks.createDataset).toHaveBeenNthCalledWith(2, {
      body: { dataset_ids: ['engineering'] },
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-dataset-token-123')
    await user.click(screen.getByRole('button', { name: 'appApi.actionMsg.ok' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' }),
    ).toBeInTheDocument()
  })
})
