import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ComponentProps } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[], input: unknown) => {
      switch (path.join('.')) {
        case 'apps.byResourceId.apiKeys.get':
          apiMocks.listApp(input)
          return { data: apiMocks.appKeys }
        case 'apps.byResourceId.apiKeys.post':
          return apiMocks.createApp(input)
        case 'apps.byResourceId.apiKeys.byApiKeyId.delete':
          return apiMocks.deleteApp(input)
        case 'datasets.apiKeys.get':
          apiMocks.listDataset()
          return { data: apiMocks.datasetKeys }
        case 'datasets.apiKeys.post':
          return apiMocks.createDataset(input)
        case 'datasets.apiKeys.byApiKeyId.delete':
          return apiMocks.deleteDataset(input)
        case 'enterprise.appDeploy.accessService.listEnvironmentApiKeys':
          apiMocks.listEnvironment(input)
          return { data: apiMocks.environmentKeys }
        case 'enterprise.appDeploy.accessService.createEnvironmentApiKey':
          return apiMocks.createEnvironment(input)
        case 'enterprise.appDeploy.accessService.deleteEnvironmentApiKey':
          return apiMocks.deleteEnvironment(input)
        default:
          throw new Error(`Unexpected API call: ${path.join('.')}`)
      }
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
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  return { ...result, onOpenChange }
}

async function confirmKeyDeletion(accessibleName: string) {
  const user = userEvent.setup()
  const deleteButton = screen.getByRole('button', { name: accessibleName })
  await user.click(deleteButton)
  await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
}

describe('ApiKeyModal', () => {
  beforeEach(() => {
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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

  it.each(['cancel', 'escape'] as const)(
    'cancels deletion with %s without closing key management, then targets another key',
    async (dismiss) => {
      const user = userEvent.setup()
      apiMocks.appKeys = [
        { id: 'first', token: 'app-first', type: 'app', created_at: 1 },
        { id: 'second', token: 'app-second', type: 'app', created_at: 1 },
      ]
      const { onOpenChange } = await renderModal(appScope)
      const firstTrigger = screen.getByRole('button', {
        name: 'common.operation.delete app...app-first',
      })
      await user.click(firstTrigger)
      const dialog = await screen.findByRole('alertdialog', {
        name: 'appApi.actionMsg.deleteConfirmTitle',
      })
      expect(dialog).toHaveAccessibleDescription('appApi.actionMsg.deleteConfirmTips')

      if (dismiss === 'cancel')
        await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      else await user.keyboard('{Escape}')

      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(firstTrigger).toHaveFocus()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks.deleteApp).not.toHaveBeenCalled()

      await confirmKeyDeletion('common.operation.delete app...app-second')
      await waitFor(() =>
        expect(apiMocks.deleteApp).toHaveBeenCalledWith({
          params: { resource_id: 'app-123', api_key_id: 'second' },
        }),
      )
    },
  )

  it.each([
    { scope: appScope, keys: 'appKeys', remove: 'deleteApp', list: 'listApp' },
    { scope: datasetScope, keys: 'datasetKeys', remove: 'deleteDataset', list: 'listDataset' },
    {
      scope: environmentScope,
      keys: 'environmentKeys',
      remove: 'deleteEnvironment',
      list: 'listEnvironment',
    },
  ] as const)(
    'keeps $scope.type deletion pending, allows retry after failure, and refreshes after success',
    async ({ scope, keys, remove, list }) => {
      const user = userEvent.setup()
      apiMocks[keys] = [{ id: 'key-1', token: 'key-secret', type: 'api', created_at: 1 }]
      let rejectDeletion!: (reason: Error) => void
      const request = new Promise<void>((_resolve, reject) => {
        rejectDeletion = reject
      })
      apiMocks[remove].mockReturnValueOnce(request)
      const { onOpenChange } = await renderModal(scope)
      await confirmKeyDeletion('common.operation.delete key...key-secret')
      const dialog = screen.getByRole('alertdialog')
      const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
      const cancel = screen.getByRole('button', { name: 'common.operation.cancel' })
      expect(confirm).toHaveAttribute('aria-disabled', 'true')
      expect(cancel).toBeDisabled()
      await user.click(confirm)
      await user.click(cancel)
      await user.keyboard('{Escape}')
      expect(dialog).toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks[remove]).toHaveBeenCalledTimes(1)

      await act(async () => rejectDeletion(new Error('Deletion failed')))
      await waitFor(() => expect(cancel).toBeEnabled())
      expect(dialog).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )

      apiMocks[remove].mockImplementationOnce(async () => {
        apiMocks[keys] = []
      })
      await user.click(confirm)
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await waitFor(() => expect(apiMocks[list]).toHaveBeenCalledTimes(2))
      expect(
        screen.queryByRole('button', { name: 'common.operation.delete key...key-secret' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
      ).toHaveFocus()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks[remove]).toHaveBeenCalledTimes(2)
    },
  )

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
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
