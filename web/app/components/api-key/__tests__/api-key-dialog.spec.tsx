import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ComponentProps } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { ApiKeyDialog } from '../api-key-dialog'

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
          await apiMocks.listApp(input)
          return { data: apiMocks.appKeys }
        case 'apps.byResourceId.apiKeys.post':
          return apiMocks.createApp(input)
        case 'apps.byResourceId.apiKeys.byApiKeyId.delete':
          return apiMocks.deleteApp(input)
        case 'datasets.apiKeys.get':
          await apiMocks.listDataset()
          return { data: apiMocks.datasetKeys }
        case 'datasets.apiKeys.post':
          return apiMocks.createDataset(input)
        case 'datasets.apiKeys.byApiKeyId.delete':
          return apiMocks.deleteDataset(input)
        case 'enterprise.appDeploy.accessService.listEnvironmentApiKeys':
          await apiMocks.listEnvironment(input)
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

function DialogHarness(props: Omit<ComponentProps<typeof ApiKeyDialog>, 'open'>) {
  const [open, setOpen] = useState(true)
  return (
    <ApiKeyDialog
      {...props}
      open={open}
      onOpenChange={(nextOpen, details) => {
        setOpen(nextOpen)
        props.onOpenChange?.(nextOpen, details)
      }}
    />
  )
}

async function renderDialog(
  scope: ComponentProps<typeof ApiKeyDialog>['scope'],
  overrides: { canManage?: boolean } = {},
) {
  const queryClient = createTestQueryClient()
  const onOpenChange = vi.fn()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <DialogHarness
        canManage={overrides.canManage ?? true}
        scope={scope}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  await screen.findByRole('button', {
    name: /appApi.apiKeyModal.createNewSecretKey|common.operation.retry/,
  })
  return { ...result, onOpenChange }
}

async function confirmKeyDeletion(accessibleName: string) {
  const user = userEvent.setup()
  const deleteButton = screen.getByRole('button', { name: accessibleName })
  await user.click(deleteButton)
  await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
}

describe('ApiKeyDialog', () => {
  beforeEach(() => {
    mockCurrentWorkspace.mockReturnValue({ id: 'workspace-1', name: 'Test Workspace' })
    apiMocks.listApp.mockReset()
    apiMocks.listDataset.mockReset()
    apiMocks.listEnvironment.mockReset()
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

  it('masks app keys visually while copying the complete value', async () => {
    const user = userEvent.setup()
    apiMocks.appKeys = [
      {
        id: 'app-key-1',
        token: 'app-secret-token-123456789',
        type: 'app',
        created_at: 1,
      },
    ]

    await renderDialog(appScope)

    expect(await screen.findByText('app-s...6789')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(await navigator.clipboard.readText()).toBe('app-secret-token-123456789')
    expect(apiMocks.listApp).toHaveBeenCalledWith({
      params: { resource_id: 'app-123' },
    })
  })

  it('loads and renders workspace dataset API keys', async () => {
    apiMocks.datasetKeys = [
      {
        id: 'dataset-key-1',
        token: 'datas...6789',
        type: 'dataset',
        created_at: 1,
      },
    ]

    await renderDialog(datasetScope)

    expect(await screen.findByText('datas...6789')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.copy' })).not.toBeInTheDocument()
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
    await renderDialog(appScope)

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    await waitFor(() => {
      expect(apiMocks.createApp).toHaveBeenCalledWith({
        params: { resource_id: 'app-123' },
      })
    })
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('new-app-token-123')
    expect(
      screen.getByRole('dialog', { name: 'appApi.apiKeyModal.createdTitle' }),
    ).toHaveAccessibleDescription('appApi.apiKeyModal.generateTips')
  })

  it('creates a workspace dataset API key scoped to all knowledge bases', async () => {
    const user = userEvent.setup()
    await renderDialog(datasetScope)

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

  it('searches for a knowledge base and creates a key scoped to the selection', async () => {
    const user = userEvent.setup()
    await renderDialog(datasetScope)

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

  it('loads environment-scoped keys without requesting built-in app keys', async () => {
    apiMocks.environmentKeys = [
      {
        id: 'environment-key-1',
        token: 'env-existing-secret-key-abcdefghijklmnopqrst',
        type: 'api',
        created_at: 1,
      },
    ]

    await renderDialog(environmentScope)

    expect(await screen.findByText('env-e...qrst')).toBeInTheDocument()
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
    await renderDialog(environmentScope)

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

  it.each(['cancel', 'escape'] as const)(
    'cancels deletion with %s without closing key management, then targets another key',
    async (dismiss) => {
      const user = userEvent.setup()
      apiMocks.appKeys = [
        { id: 'first', token: 'app-first', type: 'app', created_at: 1 },
        { id: 'second', token: 'app-second', type: 'app', created_at: 1 },
      ]
      const { onOpenChange } = await renderDialog(appScope)
      const firstTrigger = screen.getByRole('button', {
        name: 'common.operation.delete app-f...irst',
      })
      await user.click(firstTrigger)
      const dialog = await screen.findByRole('alertdialog', {
        name: 'appApi.actionMsg.deleteConfirmTitle',
      })
      expect(dialog).toHaveAccessibleDescription('app-f...irst appApi.actionMsg.deleteConfirmTips')

      if (dismiss === 'cancel')
        await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      else await user.keyboard('{Escape}')

      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(firstTrigger).toHaveFocus()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks.deleteApp).not.toHaveBeenCalled()

      await confirmKeyDeletion('common.operation.delete app-s...cond')
      await waitFor(() =>
        expect(apiMocks.deleteApp).toHaveBeenCalledWith({
          params: { resource_id: 'app-123', api_key_id: 'second' },
        }),
      )
    },
  )

  it.each([
    {
      scope: appScope,
      keys: 'appKeys',
      remove: 'deleteApp',
      list: 'listApp',
      params: { resource_id: 'app-123', api_key_id: 'key-1' },
    },
    {
      scope: datasetScope,
      keys: 'datasetKeys',
      remove: 'deleteDataset',
      list: 'listDataset',
      params: { api_key_id: 'key-1' },
    },
    {
      scope: environmentScope,
      keys: 'environmentKeys',
      remove: 'deleteEnvironment',
      list: 'listEnvironment',
      params: { app_id: 'app-123', environment_id: 'staging', api_key_id: 'key-1' },
    },
  ] as const)(
    'keeps $scope.type deletion pending, allows retry after failure, and refreshes after success',
    async ({ scope, keys, remove, list, params }) => {
      const user = userEvent.setup()
      apiMocks[keys] = [
        {
          id: 'key-1',
          token: scope.type === 'dataset' ? 'key-s...cret' : 'key-secret',
          type: 'api',
          created_at: 1,
        },
      ]
      let rejectDeletion!: (reason: Error) => void
      const request = new Promise<void>((_resolve, reject) => {
        rejectDeletion = reject
      })
      apiMocks[remove].mockReturnValueOnce(request)
      const { onOpenChange } = await renderDialog(scope)
      await confirmKeyDeletion('common.operation.delete key-s...cret')
      const dialog = screen.getByRole('alertdialog')
      const confirm = screen.getByRole('button', { name: 'common.operation.delete' })
      const cancel = screen.getByRole('button', { name: 'common.operation.cancel' })
      expect(confirm).toHaveAttribute('aria-disabled', 'true')
      expect(cancel).toBeDisabled()
      await user.click(confirm)
      await user.click(cancel)
      await user.keyboard('{Escape}')
      expect(dialog).toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks[remove]).toHaveBeenCalledExactlyOnceWith({ params })

      await act(async () => rejectDeletion(new Error('Deletion failed')))
      await waitFor(() => expect(cancel).toBeEnabled())
      expect(dialog).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.delete' })).not.toHaveAttribute(
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
        screen.queryByRole('button', { name: 'common.operation.delete key-s...cret' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
        ).toHaveFocus(),
      )
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(apiMocks[remove]).toHaveBeenCalledTimes(2)
    },
  )

  it('disables creation when the caller cannot manage keys', async () => {
    await renderDialog(datasetScope, { canManage: false })

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.createNewSecretKey',
      }),
    ).toBeDisabled()
  })

  it('exposes an accessible close button', async () => {
    const { onOpenChange } = await renderDialog(datasetScope)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })
  it.each([
    { scope: appScope, keys: 'appKeys' },
    { scope: datasetScope, keys: 'datasetKeys' },
  ] as const)(
    'keeps the create action discoverable at the $scope.type limit and enables it after deletion',
    async ({ scope, keys }) => {
      const user = userEvent.setup()
      apiMocks[keys] = Array.from({ length: 10 }, (_, index) => ({
        id: `key-${index}`,
        token: `app-key-${index}`,
        type: 'app',
        created_at: 1,
      }))
      await renderDialog(scope)
      const create = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
      expect(create).toHaveAttribute('aria-disabled', 'true')
      expect(create).not.toBeDisabled()
      expect(create).toHaveAccessibleDescription(/appApi.apiKeyModal.keyLimitReached/)
      act(() => create.focus())
      await user.keyboard('{Enter}')
      await user.click(create)
      expect(apiMocks.createApp).not.toHaveBeenCalled()
      expect(apiMocks.createDataset).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' }),
      ).not.toBeInTheDocument()
      const remove = scope.type === 'app' ? apiMocks.deleteApp : apiMocks.deleteDataset
      remove.mockImplementationOnce(async () => {
        apiMocks[keys] = apiMocks[keys].slice(1)
      })
      await user.click(screen.getByRole('button', { name: 'common.operation.delete app-k...ey-0' }))
      await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
      await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled', 'true'))
    },
  )

  it('requires acknowledgement before dismissing a newly created knowledge secret and returns focus', async () => {
    const user = userEvent.setup()
    await renderDialog(datasetScope)
    const create = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
    await user.click(create)
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const result = await screen.findByRole('alertdialog', {
      name: 'appApi.apiKeyModal.createdTitle',
    })
    expect(result).toHaveAccessibleDescription('appApi.apiKeyModal.revealOnceTips')
    const secret = within(result).getByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' })
    expect(secret).toHaveValue('new-dataset-token-123')
    const copy = within(result).getByRole('button', { name: 'common.operation.copy' })
    await waitFor(() => expect(copy).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(await navigator.clipboard.readText()).toBe('new-dataset-token-123')
    expect(
      within(result).queryByRole('button', { name: 'common.operation.close' }),
    ).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(result).toBeInTheDocument()
    await user.click(within(result).getByRole('button', { name: 'appApi.apiKeyModal.saved' }))
    await waitFor(() => expect(result).not.toBeInTheDocument())
    expect(create).toHaveFocus()
  })

  it('does not dismiss management while creating a secret', async () => {
    const user = userEvent.setup()
    let resolve!: (value: { token: string }) => void
    apiMocks.createApp.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const { onOpenChange } = await renderDialog(appScope)
    await user.click(screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => resolve({ token: 'created-secret' }))
    expect(
      await screen.findByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }),
    ).toHaveValue('created-secret')
  })

  it('blocks creation after a list failure and recovers through retry', async () => {
    apiMocks.listApp.mockRejectedValueOnce(new Error('List failed'))
    const user = userEvent.setup()
    await renderDialog(appScope)
    expect(
      screen.queryByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('appApi.apiKeyModal.emptyState')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    ).toBeEnabled()
    expect(screen.getByText('appApi.apiKeyModal.emptyState')).toBeInTheDocument()
  })

  it('starts a fresh knowledge scope selection after cancelling and reopening', async () => {
    const user = userEvent.setup()
    await renderDialog(datasetScope)
    const create = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
    await user.click(create)
    await user.click(await screen.findByRole('radio', { name: /scopeSpecificDatasets/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' }),
      ).not.toBeInTheDocument(),
    )
    await user.click(create)
    expect(await screen.findByRole('radio', { name: /scopeAllDatasets/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeEnabled()
  })
})
