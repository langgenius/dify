import type {
  KnowledgeFsSourceConnectionListResponse,
  KnowledgeFsSourceConnectionResponse,
  KnowledgeFsSourceProviderListResponse,
  KnowledgeFsSourceProviderResponse,
  KnowledgeFsSourceResponse,
  KnowledgeFsSourceWorkflowResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveSourceDraft,
} from '../routes'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { ConnectedSourceSetup } from '../connected-source-setup'

type ProviderQueryOptions = {
  input: unknown
  retry?: boolean
  select?: (response: KnowledgeFsSourceProviderListResponse) => unknown
}

type ConnectionInfiniteOptions = {
  getNextPageParam: (lastPage: KnowledgeFsSourceConnectionListResponse) => string | null | undefined
  initialPageParam: string | null
  input: (pageParam: string | null) => unknown
  retry?: boolean
}

const clientMock = vi.hoisted(() => ({
  createConnection: vi.fn(),
  createSource: vi.fn(),
  createWorkflowImport: vi.fn(),
  deleteSource: vi.fn(),
  getFiles: vi.fn(),
  getPages: vi.fn(),
  getSource: vi.fn(),
  getSyncPolicy: vi.fn(),
  getWorkflow: vi.fn(),
  importFiles: vi.fn(),
  importPages: vi.fn(),
  listConnections: vi.fn(),
  listDatasourceAuth: vi.fn(),
  listDatasourcePlugins: vi.fn(),
  listProviders: vi.fn(),
  listSources: vi.fn(),
  patchSource: vi.fn(),
  refreshConnection: vi.fn(),
  updateSyncPolicy: vi.fn(),
}))

const openMock = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-datasource', async () => {
  const { useQuery } =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    useGetDataSourceListAuth: () =>
      useQuery({
        queryFn: () => clientMock.listDatasourceAuth(),
        queryKey: ['data-source-auth', 'list'],
        retry: false,
      }),
  }
})

vi.mock('@/service/use-pipeline', async () => {
  const { useQuery } =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    useDataSourceList: (enabled: boolean) =>
      useQuery({
        enabled,
        queryFn: () => clientMock.listDatasourcePlugins(),
        queryKey: ['pipeline', 'datasource'],
        retry: false,
      }),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          sourceConnections: {
            byConnectionId: {
              refresh: {
                post: clientMock.refreshConnection,
              },
            },
            post: clientMock.createConnection,
          },
          sourceWorkflows: {
            byRunId: {
              get: clientMock.getWorkflow,
            },
          },
          sources: {
            bySourceId: {
              asyncImport: {
                post: clientMock.createWorkflowImport,
              },
              delete: clientMock.deleteSource,
              files: {
                get: clientMock.getFiles,
              },
              get: clientMock.getSource,
              import: {
                post: clientMock.importPages,
              },
              importFiles: {
                post: clientMock.importFiles,
              },
              pages: {
                get: clientMock.getPages,
              },
              patch: clientMock.patchSource,
              syncPolicy: {
                get: clientMock.getSyncPolicy,
                put: clientMock.updateSyncPolicy,
              },
              workflowImports: {
                post: clientMock.createWorkflowImport,
              },
            },
            get: clientMock.listSources,
            post: clientMock.createSource,
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          documents: {
            get: {
              key: () => ['knowledge-documents'],
            },
          },
          sourceConnections: {
            get: {
              infiniteOptions: (options: ConnectionInfiniteOptions) => ({
                getNextPageParam: options.getNextPageParam,
                initialPageParam: options.initialPageParam,
                queryFn: ({ pageParam }: { pageParam: string | null }) =>
                  clientMock.listConnections(options.input(pageParam)),
                queryKey: ['source-connections'],
                retry: options.retry,
              }),
              key: () => ['source-connections'],
            },
          },
          sourceProviders: {
            get: {
              queryOptions: (options: ProviderQueryOptions) => ({
                queryFn: async () => {
                  const response = await clientMock.listProviders(options.input)
                  return options.select ? options.select(response) : response
                },
                queryKey: ['source-providers'],
                retry: options.retry,
              }),
            },
          },
          sources: {
            get: {
              key: () => ['knowledge-sources'],
            },
          },
        },
      },
    },
  },
}))

const notionProvider: KnowledgeFsSourceProviderResponse = {
  auth_kinds: ['endpoint'],
  available: true,
  capabilities: ['online-document'],
  configuration: [
    {
      name: 'credentialId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'pluginId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'provider',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'datasource',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'providerKind',
      required: true,
      secret: false,
      type: 'string',
    },
  ],
  display_name: 'Notion',
  id: 'notion-provider',
  unavailable_reason: null,
}

const notionCredential: DataSourceCredential = {
  avatar_url: '',
  credential: {},
  id: 'notion-credential-1',
  is_default: true,
  name: 'Default Notion',
  type: 'oauth2' as DataSourceCredential['type'],
}

const notionDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Notion pages', zh_Hans: 'Notion 页面' },
        identity: {
          author: 'langgenius',
          icon: 'icon.svg',
          label: { en_US: 'Notion', zh_Hans: 'Notion' },
          name: 'notion',
          provider: 'notion',
        },
        parameters: [],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Notion', zh_Hans: 'Notion' },
      icon: 'icon.svg',
      label: { en_US: 'Notion', zh_Hans: 'Notion' },
      name: 'notion',
      tags: [],
    },
    provider_type: 'online_document',
  },
  is_authorized: true,
  plugin_id: 'langgenius/notion_datasource',
  plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
  provider: 'notion',
}

const notionDatasourcePluginWithParameters: DataSourceItem = {
  ...notionDatasourcePlugin,
  declaration: {
    ...notionDatasourcePlugin.declaration,
    datasources: [
      {
        ...notionDatasourcePlugin.declaration.datasources[0]!,
        parameters: [
          {
            label: { en_US: 'Workspace' },
            name: 'workspace',
            required: true,
            type: 'string',
          },
        ],
      },
    ],
  },
}

const s3Provider: KnowledgeFsSourceProviderResponse = {
  auth_kinds: ['endpoint'],
  available: true,
  capabilities: ['online-drive'],
  configuration: [
    {
      name: 'credentialId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'pluginId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'provider',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'datasource',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'providerKind',
      required: true,
      secret: false,
      type: 'string',
    },
  ],
  display_name: 'Amazon S3',
  id: 's3-provider',
  unavailable_reason: null,
}

const s3Credential: DataSourceCredential = {
  avatar_url: '',
  credential: { region: 'us-west-2' },
  id: 's3-credential-1',
  is_default: true,
  name: 'AWS S3',
  type: 'api-key' as DataSourceCredential['type'],
}

const s3DatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Amazon S3 files', zh_Hans: 'Amazon S3 文件' },
        identity: {
          author: 'langgenius',
          icon: 'icon.svg',
          label: { en_US: 'Amazon S3', zh_Hans: 'Amazon S3' },
          name: 'aws_s3_storage',
          provider: 'aws_s3_storage',
        },
        parameters: [],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Amazon S3', zh_Hans: 'Amazon S3' },
      icon: 'icon.svg',
      label: { en_US: 'Amazon S3', zh_Hans: 'Amazon S3' },
      name: 'aws_s3_storage',
      tags: [],
    },
    provider_type: 'online_drive',
  },
  is_authorized: true,
  plugin_id: 'langgenius/aws_s3_storage',
  plugin_unique_identifier: 'langgenius/aws_s3_storage:1.0.0@local',
  provider: 'aws_s3_storage',
}

const s3DatasourceAuth: DataSourceAuth = {
  author: 'langgenius',
  credentials_list: [s3Credential],
  description: { en_US: 'Amazon S3', zh_Hans: 'Amazon S3' },
  icon: 'icon.svg',
  label: { en_US: 'Amazon S3', zh_Hans: 'Amazon S3' },
  name: 'aws_s3_storage',
  plugin_id: 'langgenius/aws_s3_storage',
  plugin_unique_identifier: 'langgenius/aws_s3_storage:1.0.0@local',
  provider: 'aws_s3_storage',
}

function notionDatasourceAuth(credentials: DataSourceCredential[] = []): DataSourceAuth {
  return {
    author: 'langgenius',
    credentials_list: credentials,
    description: { en_US: 'Notion', zh_Hans: 'Notion' },
    icon: 'icon.svg',
    label: { en_US: 'Notion', zh_Hans: 'Notion' },
    name: 'notion',
    plugin_id: 'langgenius/notion_datasource',
    plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
    provider: 'notion',
  }
}

function connectionResponse(
  overrides: Partial<KnowledgeFsSourceConnectionResponse> = {},
): KnowledgeFsSourceConnectionResponse {
  return {
    auth_kind: 'endpoint',
    configuration: {
      credentialId: notionCredential.id,
      datasource: 'notion',
      pluginId: 'langgenius/notion_datasource',
      provider: 'notion',
      providerKind: 'online-document',
    },
    created_at: '2026-07-20T10:00:00Z',
    error_code: null,
    expires_at: null,
    id: 'connection-1',
    knowledge_space_id: 'space-1',
    name: 'Default Notion',
    provider_id: notionProvider.id,
    scopes: [],
    status: 'active',
    updated_at: '2026-07-20T10:00:00Z',
    version: 2,
    ...overrides,
  }
}

function sourceResponse(
  overrides: Partial<KnowledgeFsSourceResponse> = {},
): KnowledgeFsSourceResponse {
  return {
    connection_id: 'connection-1',
    created_at: '2026-07-20T10:00:00Z',
    credential_configured: true,
    id: 'preview-source',
    knowledge_space_id: 'space-1',
    metadata: {},
    name: 'Notion',
    permission_scope: [],
    status: 'disabled',
    type: 'connector',
    updated_at: '2026-07-20T10:00:00Z',
    uri: 'notion://connection-1',
    version: 3,
    ...overrides,
  }
}

function workflowResponse(
  state: string,
  overrides: Partial<KnowledgeFsSourceWorkflowResponse> = {},
): KnowledgeFsSourceWorkflowResponse {
  return {
    checkpoint: 'import',
    created_at: '2026-07-20T10:00:00Z',
    execution_attempts: 1,
    id: 'import-run-1',
    knowledge_space_id: 'space-1',
    kind: 'online-document-import',
    max_execution_attempts: 3,
    progress_completed: 0,
    progress_failed: 0,
    progress_skipped: 0,
    progress_total: 1,
    source_id: 'preview-source',
    state,
    updated_at: '2026-07-20T10:00:00Z',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const defaultDraft: NewKnowledgeOnlineDocumentsSourceDraft = {
  provider: 'Notion',
  sourceName: '',
  sourceType: 'onlineDocuments',
  syncPolicy: 'provider',
}

type ConnectedDraft = NewKnowledgeOnlineDocumentsSourceDraft | NewKnowledgeOnlineDriveSourceDraft

function renderSetup(draft: ConnectedDraft = defaultDraft) {
  const queryClient = createTestQueryClient()
  const onCompleted = vi.fn()
  const onDirtyChange = vi.fn()
  const onDraftChange = vi.fn()
  const onExit = vi.fn()
  const content = (nextDraft: ConnectedDraft) => (
    <QueryClientProvider client={queryClient}>
      <ConnectedSourceSetup
        draft={nextDraft}
        knowledgeSpaceId="space-1"
        onCompleted={onCompleted}
        onDirtyChange={onDirtyChange}
        onDraftChange={onDraftChange}
        onExit={onExit}
      />
    </QueryClientProvider>
  )
  const view = render(content(draft))
  return {
    ...view,
    onCompleted,
    onDirtyChange,
    onDraftChange,
    onExit,
    queryClient,
    rerenderDraft: (nextDraft: ConnectedDraft) => view.rerender(content(nextDraft)),
  }
}

function renderStatefulSetup(draft: ConnectedDraft = defaultDraft) {
  const queryClient = createTestQueryClient()
  const onCompleted = vi.fn()
  const onDirtyChange = vi.fn()
  const onDraftChange = vi.fn()
  const onExit = vi.fn()

  function StatefulSetup() {
    const [currentDraft, setCurrentDraft] = useState(draft)
    return (
      <QueryClientProvider client={queryClient}>
        <ConnectedSourceSetup
          draft={currentDraft}
          knowledgeSpaceId="space-1"
          onCompleted={onCompleted}
          onDirtyChange={onDirtyChange}
          onDraftChange={(nextDraft) => {
            onDraftChange(nextDraft)
            setCurrentDraft(nextDraft as ConnectedDraft)
          }}
          onExit={onExit}
        />
      </QueryClientProvider>
    )
  }

  return { ...render(<StatefulSetup />), onDraftChange }
}

describe('ConnectedSourceSetup', () => {
  beforeEach(() => {
    for (const mock of Object.values(clientMock)) mock.mockReset()
    openMock.mockReset()
    vi.stubGlobal('open', openMock)

    clientMock.listProviders.mockResolvedValue({
      data: [notionProvider],
    } satisfies KnowledgeFsSourceProviderListResponse)
    clientMock.listDatasourcePlugins.mockResolvedValue([notionDatasourcePlugin])
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth()],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.listSources.mockResolvedValue({ data: [], next_cursor: null })
    clientMock.createSource.mockResolvedValue(sourceResponse())
    clientMock.patchSource.mockResolvedValue(
      sourceResponse({ name: 'Team wiki', status: 'active', version: 4 }),
    )
    clientMock.createWorkflowImport.mockResolvedValue(workflowResponse('completed'))
    clientMock.getWorkflow.mockResolvedValue(workflowResponse('completed'))
    clientMock.getSyncPolicy.mockRejectedValue(
      Object.assign(new Error('sync policy not found'), { status: 404 }),
    )
    clientMock.deleteSource.mockResolvedValue({ status: 'accepted' })
    clientMock.getFiles.mockResolvedValue({ buckets: [] })
    clientMock.getPages.mockResolvedValue({ next_cursor: null, workspaces: [] })
    clientMock.getSource.mockResolvedValue(sourceResponse({ status: 'active', version: 5 }))
    clientMock.importFiles.mockResolvedValue({ documents: [], failed: [], skipped: [] })
    clientMock.importPages.mockResolvedValue({ documents: [], failed: [], skipped: [] })
    clientMock.updateSyncPolicy.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the sync policy available while provider data is loading', () => {
    clientMock.listProviders.mockReturnValue(new Promise(() => undefined))

    renderSetup()

    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeEnabled()
  })

  it('shows the Notion connection card and opens the provider package when no credential exists', async () => {
    const user = userEvent.setup()
    const view = renderSetup()

    expect(await screen.findByText('dataset.newKnowledge.notionNotConnected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    expect(clientMock.createConnection).not.toHaveBeenCalled()
    expect(view.container.querySelectorAll('img[src="icon.svg"]')).toHaveLength(2)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.connectProvider:{"provider":"Notion"}',
      }),
    )

    expect(openMock).toHaveBeenCalledWith(
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fnotion_datasource%22%5D',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('does not reuse a stale Notion connection after its credential is removed', async () => {
    clientMock.listConnections.mockResolvedValue({
      data: [connectionResponse()],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)

    renderSetup()

    expect(await screen.findByText('dataset.newKnowledge.notionNotConnected')).toBeInTheDocument()
    expect(clientMock.createSource).not.toHaveBeenCalled()
    expect(clientMock.getPages).not.toHaveBeenCalled()
    expect(clientMock.createConnection).not.toHaveBeenCalled()
  })

  it('distinguishes an uninstalled provider from an installed provider without credentials', async () => {
    const user = userEvent.setup()
    renderSetup({
      ...defaultDraft,
      provider: 'Confluence',
    })

    expect(await screen.findByText('workflow.nodes.common.pluginNotInstalled')).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.notionNotConnected')).not.toBeInTheDocument()
    expect(clientMock.createConnection).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'plugin.installPlugin' }))
    expect(openMock).toHaveBeenCalledWith(
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fconfluence_datasource%22%5D',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('starts the selected Notion import and completes setup without waiting for indexing', async () => {
    const user = userEvent.setup()
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth([notionCredential])],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [connectionResponse()],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.createSource.mockResolvedValue(sourceResponse())
    clientMock.patchSource.mockResolvedValue(
      sourceResponse({
        metadata: { preview: false },
        name: 'Team wiki',
        status: 'active',
        version: 4,
      }),
    )
    clientMock.createWorkflowImport.mockResolvedValue(workflowResponse('queued'))
    clientMock.getWorkflow.mockReturnValue(new Promise(() => undefined))
    clientMock.getPages.mockResolvedValue({
      next_cursor: null,
      workspaces: [
        {
          pages: [
            {
              last_edited_time: '2026-07-21T12:00:00Z',
              page_id: 'page-1',
              page_name: 'Product roadmap',
              parent_id: null,
              type: 'page',
            },
          ],
          total: 1,
          workspace_id: 'workspace-1',
          workspace_name: 'Acme workspace',
        },
      ],
    })
    clientMock.importPages.mockResolvedValue({
      documents: [{ document_asset_id: 'asset-1', filename: 'Product roadmap' }],
      failed: [],
      skipped: [],
    })
    const view = renderSetup({ ...defaultDraft, sourceName: 'Team wiki' })

    const page = await screen.findByRole('checkbox', { name: 'Product roadmap' })
    expect(clientMock.createSource).toHaveBeenNthCalledWith(1, {
      body: {
        connectionId: 'connection-1',
        metadata: {
          clientRequestId: expect.any(String),
          datasourceParameterMode: 'exact',
          parameters: {},
          preview: true,
          providerId: 'notion-provider',
          providerKind: 'online-document',
          providerName: 'Notion',
          sourceType: 'onlineDocuments',
        },
        name: 'Notion',
        permissionScope: [],
        status: 'disabled',
        type: 'connector',
        uri: 'notion://connection-1',
      },
      params: { control_space_id: 'space-1' },
    })
    expect(clientMock.getPages).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', source_id: 'preview-source' },
      query: { limit: 200 },
    })
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeDisabled()

    await user.click(page)
    expect(addSource).toBeEnabled()
    expect(screen.getByText('dataset.newKnowledge.pagesSelected:{"count":1}')).toBeInTheDocument()
    const currentAddSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    await user.click(currentAddSource)

    await waitFor(() => expect(view.onCompleted).toHaveBeenCalledOnce())
    expect(clientMock.createSource).toHaveBeenCalledOnce()
    expect(clientMock.patchSource).toHaveBeenCalledWith({
      body: {
        expectedVersion: 3,
        name: 'Team wiki',
      },
      params: { control_space_id: 'space-1', source_id: 'preview-source' },
    })
    expect(clientMock.createWorkflowImport).toHaveBeenCalledWith({
      body: {
        items: [
          {
            lastEditedTime: '2026-07-21T12:00:00Z',
            name: 'Product roadmap',
            pageId: 'page-1',
            providerItemId: '["workspace-1","page-1"]',
            type: 'page',
            workspaceId: 'workspace-1',
          },
        ],
        kind: 'online-document-import',
        syncPolicy: { enabled: true, mode: 'provider' },
      },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1', source_id: 'preview-source' },
    })
    expect(clientMock.getWorkflow).not.toHaveBeenCalled()
    expect(clientMock.getSource).not.toHaveBeenCalled()
    expect(clientMock.getSyncPolicy).not.toHaveBeenCalled()
    expect(clientMock.updateSyncPolicy).not.toHaveBeenCalled()
    expect(clientMock.createWorkflowImport.mock.invocationCallOrder[0]).toBeLessThan(
      view.onCompleted.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )

    view.unmount()
    expect(clientMock.deleteSource).not.toHaveBeenCalled()
  })

  it('reconciles an accepted import when the response is lost before navigation', async () => {
    const user = userEvent.setup()
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth([notionCredential])],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [connectionResponse()],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.getPages.mockResolvedValue({
      next_cursor: null,
      workspaces: [
        {
          pages: [
            {
              last_edited_time: null,
              page_id: 'page-1',
              page_name: 'Product roadmap',
              parent_id: null,
              type: 'page',
            },
          ],
          total: 1,
          workspace_id: 'workspace-1',
          workspace_name: 'Acme workspace',
        },
      ],
    })
    clientMock.createWorkflowImport.mockRejectedValue(new TypeError('Failed to fetch'))
    clientMock.getSource.mockResolvedValue(
      sourceResponse({
        metadata: {
          pendingImport: {
            kind: 'online-document-import',
            syncPolicy: { enabled: true, mode: 'provider' },
            workflowId: 'import-run-1',
          },
          preview: false,
        },
        name: 'Team wiki',
        status: 'disabled',
        version: 5,
      }),
    )
    const view = renderSetup({ ...defaultDraft, sourceName: 'Team wiki' })

    await user.click(await screen.findByRole('checkbox', { name: 'Product roadmap' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(view.onCompleted).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    view.unmount()
    expect(clientMock.deleteSource).not.toHaveBeenCalled()
  })

  it('applies datasource parameters once instead of rebuilding the preview on every keypress', async () => {
    const user = userEvent.setup()
    clientMock.listDatasourcePlugins.mockResolvedValue([notionDatasourcePluginWithParameters])
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth([notionCredential])],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [connectionResponse()],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)

    renderStatefulSetup({ ...defaultDraft, parameters: {} })

    const workspace = await screen.findByRole('textbox', { name: 'Workspace' })
    await user.type(workspace, 'product-docs')

    expect(clientMock.createSource).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    await waitFor(() => expect(clientMock.createSource).toHaveBeenCalledOnce())
    expect(clientMock.createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          metadata: expect.objectContaining({ parameters: { workspace: 'product-docs' } }),
        }),
      }),
    )
  })

  it('creates the managed endpoint connection automatically from the default credential', async () => {
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth([notionCredential])],
    })
    clientMock.createConnection.mockResolvedValue(connectionResponse())

    const view = renderSetup({ ...defaultDraft, sourceName: 'Team wiki' })

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'endpoint',
          configuration: {
            credentialId: 'notion-credential-1',
            datasource: 'notion',
            pluginId: 'langgenius/notion_datasource',
            provider: 'notion',
            providerKind: 'online-document',
          },
          credentials: {},
          name: 'Default Notion',
          providerId: 'notion-provider',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(clientMock.createConnection).toHaveBeenCalledOnce()

    view.unmount()
  })

  it('replaces a failed managed connection without calling the forbidden refresh endpoint', async () => {
    const user = userEvent.setup()
    const failedConnection = connectionResponse({
      error_code: 'PROVIDER_AUTH_FAILED',
      status: 'error',
    })
    const recoveredConnection = connectionResponse({
      id: 'connection-recovered',
      status: 'active',
      version: 3,
    })
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [notionDatasourceAuth([notionCredential])],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [failedConnection],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.createConnection.mockResolvedValue(recoveredConnection)

    renderSetup({ ...defaultDraft, sourceName: 'Recovered wiki' })

    expect(
      await screen.findByText(
        'dataset.newKnowledge.connectionNeedsAttention:{"provider":"Notion"}',
      ),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.connectProvider:{"provider":"Notion"}',
      }),
    )
    expect(openMock).toHaveBeenCalledWith(
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fnotion_datasource%22%5D',
      '_blank',
      'noopener,noreferrer',
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryProviderLoad' }))

    await waitFor(() => expect(clientMock.createConnection).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(clientMock.createSource).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            connectionId: 'connection-recovered',
          }),
        }),
      ),
    )
    expect(clientMock.refreshConnection).not.toHaveBeenCalled()
  })

  it('uses the Google Drive datasource as the Google Docs transport and imports a selected doc', async () => {
    const user = userEvent.setup()
    const googleCredential: DataSourceCredential = {
      avatar_url: '',
      credential: {},
      id: 'google-credential-1',
      is_default: true,
      name: 'docs@example.com',
      type: 'oauth2' as DataSourceCredential['type'],
    }
    const googleProvider: KnowledgeFsSourceProviderResponse = {
      ...s3Provider,
      display_name: 'Google Drive',
      id: 'google-drive-provider',
    }
    const googleDatasourcePlugin: DataSourceItem = {
      ...s3DatasourcePlugin,
      declaration: {
        ...s3DatasourcePlugin.declaration,
        datasources: [
          {
            description: { en_US: 'Google Drive files', zh_Hans: 'Google Drive 文件' },
            identity: {
              author: 'langgenius',
              icon: 'icon.svg',
              label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
              name: 'google_drive',
              provider: 'google_drive',
            },
            parameters: [],
          },
        ],
        identity: {
          ...s3DatasourcePlugin.declaration.identity,
          description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
          label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
          name: 'google_drive',
        },
      },
      plugin_id: 'langgenius/google_drive',
      plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
      provider: 'google_drive',
    }
    const googleDatasourceAuth: DataSourceAuth = {
      ...s3DatasourceAuth,
      credentials_list: [googleCredential],
      description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      name: 'google_drive',
      plugin_id: 'langgenius/google_drive',
      plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
      provider: 'google_drive',
    }
    const googleConnection = connectionResponse({
      configuration: {
        credentialId: googleCredential.id,
        datasource: 'google_drive',
        pluginId: 'langgenius/google_drive',
        provider: 'google_drive',
        providerKind: 'online-drive',
      },
      id: 'google-connection',
      name: 'docs@example.com',
      provider_id: googleProvider.id,
    })
    const googlePreviewSource = sourceResponse({
      connection_id: googleConnection.id,
      id: 'google-docs-preview',
      name: 'Google Docs',
      uri: 'gdocs://google-connection',
    })
    const googleDraft: NewKnowledgeOnlineDocumentsSourceDraft = {
      provider: 'Google Docs',
      sourceName: 'Team docs',
      sourceType: 'onlineDocuments',
      syncPolicy: 'provider',
    }

    clientMock.listProviders.mockResolvedValue({
      data: [googleProvider],
    } satisfies KnowledgeFsSourceProviderListResponse)
    clientMock.listDatasourcePlugins.mockResolvedValue([googleDatasourcePlugin])
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [googleDatasourceAuth],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [googleConnection],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.createSource.mockResolvedValue(googlePreviewSource)
    clientMock.patchSource.mockResolvedValue(
      sourceResponse({
        connection_id: googleConnection.id,
        id: googlePreviewSource.id,
        name: googleDraft.sourceName,
        status: 'active',
        uri: googlePreviewSource.uri,
        version: 4,
      }),
    )
    clientMock.getSource.mockResolvedValue(
      sourceResponse({
        connection_id: googleConnection.id,
        id: googlePreviewSource.id,
        name: googleDraft.sourceName,
        status: 'active',
        uri: googlePreviewSource.uri,
        version: 5,
      }),
    )
    clientMock.createWorkflowImport.mockResolvedValue(
      workflowResponse('completed', {
        kind: 'online-drive-import',
        source_id: googlePreviewSource.id,
      }),
    )
    clientMock.getFiles.mockImplementation(({ query }: { query: { prefix?: string } }) =>
      query.prefix === 'folder-1'
        ? Promise.resolve({
            buckets: [
              {
                bucket: null,
                continuation_token: null,
                files: [
                  {
                    id: 'doc-1',
                    name: 'Launch plan',
                    type: 'application/vnd.google-apps.document',
                  },
                  {
                    id: 'doc-2',
                    name: 'Meeting notes',
                    type: 'application/vnd.google-apps.document',
                  },
                ],
                is_truncated: false,
              },
            ],
          })
        : Promise.resolve({
            buckets: [
              {
                bucket: null,
                continuation_token: null,
                files: [
                  {
                    id: 'folder-1',
                    name: 'My Drive',
                    type: 'folder',
                  },
                ],
                is_truncated: false,
              },
            ],
          }),
    )

    const view = renderSetup(googleDraft)

    expect(
      await screen.findByText('dataset.newKnowledge.selectFoldersAndDocsToSync'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('dataset.newKnowledge.searchDocuments')).not.toBeInTheDocument()
    expect(clientMock.createConnection).not.toHaveBeenCalled()
    expect(clientMock.createSource).toHaveBeenCalledWith({
      body: {
        connectionId: googleConnection.id,
        metadata: {
          clientRequestId: expect.any(String),
          datasourceParameterMode: 'exact',
          parameters: {},
          preview: true,
          providerId: googleProvider.id,
          providerKind: 'online-drive',
          providerName: 'Google Docs',
          sourceType: 'onlineDocuments',
        },
        name: 'Google Docs',
        permissionScope: [],
        status: 'disabled',
        type: 'connector',
        uri: 'gdocs://google-connection',
      },
      params: { control_space_id: 'space-1' },
    })

    const driveFolder = await screen.findByRole('checkbox', { name: 'My Drive' })
    const driveFolderDisclosure = screen.getByRole('button', { name: 'My Drive' })
    expect(driveFolderDisclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(driveFolderDisclosure)
    expect(driveFolderDisclosure).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(clientMock.getFiles).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1', source_id: googlePreviewSource.id },
        query: { maxKeys: 200, prefix: 'folder-1' },
      }),
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Launch plan' }))
    expect(driveFolder).toHaveAttribute('aria-checked', 'mixed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(view.onCompleted).toHaveBeenCalledOnce())
    expect(clientMock.createWorkflowImport).toHaveBeenCalledWith({
      body: {
        items: [
          {
            bucket: undefined,
            id: 'doc-1',
            mimeType: 'application/vnd.google-apps.document',
            name: 'Launch plan',
            providerItemId: '["","doc-1"]',
          },
        ],
        kind: 'online-drive-import',
        syncPolicy: { enabled: true, mode: 'provider' },
      },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1', source_id: googlePreviewSource.id },
    })
    expect(clientMock.updateSyncPolicy).not.toHaveBeenCalled()

    view.unmount()
    expect(clientMock.deleteSource).not.toHaveBeenCalled()
  })

  it('selects an Amazon S3 folder across pages and imports only descendant files', async () => {
    const user = userEvent.setup()
    const s3Draft: NewKnowledgeOnlineDriveSourceDraft = {
      provider: 'Amazon S3',
      sourceName: 'Product archive',
      sourceType: 'onlineDrive',
      syncPolicy: 'provider',
    }
    const s3Connection = connectionResponse({
      configuration: {
        credentialId: 's3-credential-1',
        datasource: 'aws_s3_storage',
        pluginId: 'langgenius/aws_s3_storage',
        provider: 'aws_s3_storage',
        providerKind: 'online-drive',
      },
      id: 's3-connection',
      name: 'AWS S3',
      provider_id: 's3-provider',
    })
    const s3PreviewSource = sourceResponse({
      connection_id: 's3-connection',
      id: 's3-preview',
      name: 'Amazon S3',
      uri: 's3://s3-connection',
    })
    const archiveSecondPageResponse = {
      buckets: [
        {
          bucket: 'product-bucket',
          continuation_token: null,
          files: [
            {
              id: 'archive/summary.txt',
              name: 'summary.txt',
              size: 1024,
              type: 'file',
            },
          ],
          is_truncated: false,
        },
      ],
    }
    const archiveSecondPage = deferred<typeof archiveSecondPageResponse>()

    clientMock.listProviders.mockResolvedValue({
      data: [s3Provider],
    } satisfies KnowledgeFsSourceProviderListResponse)
    clientMock.listDatasourcePlugins.mockResolvedValue([s3DatasourcePlugin])
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [s3DatasourceAuth],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [s3Connection],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.createSource.mockResolvedValue(s3PreviewSource)
    clientMock.patchSource.mockResolvedValue(
      sourceResponse({
        connection_id: 's3-connection',
        id: 's3-preview',
        metadata: { preview: false },
        name: 'Product archive',
        status: 'active',
        uri: 's3://s3-connection',
        version: 4,
      }),
    )
    clientMock.createWorkflowImport.mockResolvedValue(
      workflowResponse('completed', {
        kind: 'online-drive-import',
        source_id: 's3-preview',
      }),
    )
    clientMock.getFiles.mockImplementation(
      ({
        query,
      }: {
        query: {
          bucket?: string
          continuationToken?: string
          prefix?: string
        }
      }) => {
        if (!query.bucket)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'product-bucket',
                continuation_token: null,
                files: [],
                is_truncated: false,
              },
            ],
          })
        if (!query.prefix)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'product-bucket',
                continuation_token: null,
                files: [
                  {
                    id: 'archive/',
                    name: 'Archive',
                    type: 'folder',
                  },
                ],
                is_truncated: false,
              },
            ],
          })
        if (query.prefix === 'archive/' && !query.continuationToken)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'product-bucket',
                continuation_token: 'archive-next',
                files: [
                  {
                    id: 'archive/report.pdf',
                    name: 'report.pdf',
                    size: 4096,
                    type: 'file',
                  },
                  {
                    id: 'archive/nested/',
                    name: 'Nested',
                    type: 'folder',
                  },
                ],
                is_truncated: true,
              },
            ],
          })
        if (query.prefix === 'archive/' && query.continuationToken === 'archive-next')
          return archiveSecondPage.promise
        if (query.prefix === 'archive/nested/')
          return Promise.resolve({
            buckets: [
              {
                bucket: 'product-bucket',
                continuation_token: null,
                files: [
                  {
                    id: 'archive/nested/notes.md',
                    name: 'notes.md',
                    size: 512,
                    type: 'file',
                  },
                ],
                is_truncated: false,
              },
            ],
          })
        throw new Error(`Unexpected S3 browse query: ${JSON.stringify(query)}`)
      },
    )

    const view = renderSetup(s3Draft)

    await waitFor(() =>
      expect(view.onDraftChange).toHaveBeenCalledWith({
        ...s3Draft,
        syncPolicy: 'daily',
      }),
    )
    view.rerenderDraft({ ...s3Draft, syncPolicy: 'daily' })

    const bucket = await screen.findByRole('button', { name: 'product-bucket' })
    expect(screen.getByText('s3://product-bucket · us-west-2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' })).toBeEnabled()
    expect(screen.queryByRole('checkbox', { name: 'product-bucket' })).not.toBeInTheDocument()
    expect(bucket).toHaveAttribute('aria-expanded', 'false')
    expect(clientMock.createConnection).not.toHaveBeenCalled()
    expect(clientMock.createSource).toHaveBeenCalledWith({
      body: {
        connectionId: 's3-connection',
        metadata: {
          clientRequestId: expect.any(String),
          datasourceParameterMode: 'exact',
          parameters: {},
          preview: true,
          providerId: 's3-provider',
          providerKind: 'online-drive',
          providerName: 'Amazon S3',
          sourceType: 'onlineDrive',
        },
        name: 'Amazon S3',
        permissionScope: [],
        status: 'disabled',
        type: 'connector',
        uri: 's3://s3-connection',
      },
      params: { control_space_id: 'space-1' },
    })
    expect(clientMock.getFiles).toHaveBeenNthCalledWith(1, {
      params: { control_space_id: 'space-1', source_id: 's3-preview' },
      query: { maxKeys: 200 },
    })

    await user.click(bucket)
    expect(bucket).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(clientMock.getFiles).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1', source_id: 's3-preview' },
        query: { bucket: 'product-bucket', maxKeys: 200 },
      }),
    )

    const folder = await screen.findByRole('checkbox', { name: 'Archive' })
    expect(folder).toHaveAttribute('aria-checked', 'false')
    await user.click(folder)
    await waitFor(() =>
      expect(clientMock.getFiles).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1', source_id: 's3-preview' },
        query: {
          bucket: 'product-bucket',
          maxKeys: 200,
          prefix: 'archive/',
        },
      }),
    )
    await waitFor(() =>
      expect(clientMock.getFiles).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1', source_id: 's3-preview' },
        query: {
          bucket: 'product-bucket',
          continuationToken: 'archive-next',
          maxKeys: 200,
          prefix: 'archive/',
        },
      }),
    )
    expect(folder).toHaveAttribute('aria-disabled', 'true')
    expect(folder).toHaveAttribute('aria-checked', 'true')

    await act(async () => archiveSecondPage.resolve(archiveSecondPageResponse))
    await waitFor(() =>
      expect(clientMock.getFiles).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1', source_id: 's3-preview' },
        query: {
          bucket: 'product-bucket',
          maxKeys: 200,
          prefix: 'archive/nested/',
        },
      }),
    )
    await screen.findByText('dataset.newKnowledge.pagesSelected:{"count":3}')
    expect(folder).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('checkbox', { name: 'report.pdf' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'summary.txt' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Nested' }))
    expect(await screen.findByRole('checkbox', { name: 'notes.md' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(view.onCompleted).toHaveBeenCalledOnce())
    expect(clientMock.createWorkflowImport).toHaveBeenCalledOnce()
    const workflowRequest = clientMock.createWorkflowImport.mock.calls[0]?.[0]
    expect(workflowRequest).toEqual({
      body: {
        items: [
          {
            bucket: 'product-bucket',
            id: 'archive/report.pdf',
            mimeType: undefined,
            name: 'report.pdf',
            providerItemId: '["product-bucket","archive/report.pdf"]',
          },
          {
            bucket: 'product-bucket',
            id: 'archive/summary.txt',
            mimeType: undefined,
            name: 'summary.txt',
            providerItemId: '["product-bucket","archive/summary.txt"]',
          },
          {
            bucket: 'product-bucket',
            id: 'archive/nested/notes.md',
            mimeType: undefined,
            name: 'notes.md',
            providerItemId: '["product-bucket","archive/nested/notes.md"]',
          },
        ],
        kind: 'online-drive-import',
        syncPolicy: { enabled: true, mode: 'interval' },
      },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1', source_id: 's3-preview' },
    })
    expect(JSON.parse(JSON.stringify(workflowRequest?.body))).toEqual({
      items: [
        {
          bucket: 'product-bucket',
          id: 'archive/report.pdf',
          name: 'report.pdf',
          providerItemId: '["product-bucket","archive/report.pdf"]',
        },
        {
          bucket: 'product-bucket',
          id: 'archive/summary.txt',
          name: 'summary.txt',
          providerItemId: '["product-bucket","archive/summary.txt"]',
        },
        {
          bucket: 'product-bucket',
          id: 'archive/nested/notes.md',
          name: 'notes.md',
          providerItemId: '["product-bucket","archive/nested/notes.md"]',
        },
      ],
      kind: 'online-drive-import',
      syncPolicy: { enabled: true, mode: 'interval' },
    })
    expect(clientMock.updateSyncPolicy).not.toHaveBeenCalled()

    view.unmount()
    expect(clientMock.deleteSource).not.toHaveBeenCalled()
  })

  it('rejects an oversized folder selection atomically at the 200-file limit', async () => {
    const user = userEvent.setup()
    const s3Draft: NewKnowledgeOnlineDriveSourceDraft = {
      provider: 'Amazon S3',
      sourceName: 'Oversized archive',
      sourceType: 'onlineDrive',
      syncPolicy: 'daily',
    }
    const s3Connection = connectionResponse({
      configuration: {
        credentialId: 's3-credential-1',
        datasource: 'aws_s3_storage',
        pluginId: 'langgenius/aws_s3_storage',
        provider: 'aws_s3_storage',
        providerKind: 'online-drive',
      },
      id: 's3-limit-connection',
      name: 'AWS S3',
      provider_id: 's3-provider',
    })
    const s3PreviewSource = sourceResponse({
      connection_id: s3Connection.id,
      id: 's3-limit-preview',
      name: 'Amazon S3',
      uri: 's3://s3-limit-connection',
    })
    const firstPageFiles = Array.from({ length: 200 }, (_, index) => ({
      id: `large/file-${index + 1}.txt`,
      name: `file-${index + 1}.txt`,
      type: 'file',
    }))

    clientMock.listProviders.mockResolvedValue({
      data: [s3Provider],
    } satisfies KnowledgeFsSourceProviderListResponse)
    clientMock.listDatasourcePlugins.mockResolvedValue([s3DatasourcePlugin])
    clientMock.listDatasourceAuth.mockResolvedValue({
      result: [s3DatasourceAuth],
    })
    clientMock.listConnections.mockResolvedValue({
      data: [s3Connection],
      next_cursor: null,
    } satisfies KnowledgeFsSourceConnectionListResponse)
    clientMock.createSource.mockResolvedValue(s3PreviewSource)
    clientMock.getFiles.mockImplementation(
      ({
        query,
      }: {
        query: {
          bucket?: string
          continuationToken?: string
          prefix?: string
        }
      }) => {
        if (!query.bucket)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'limit-bucket',
                continuation_token: null,
                files: [],
                is_truncated: false,
              },
            ],
          })
        if (!query.prefix)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'limit-bucket',
                continuation_token: null,
                files: [
                  {
                    id: 'large/',
                    name: 'Large folder',
                    type: 'folder',
                  },
                ],
                is_truncated: false,
              },
            ],
          })
        if (!query.continuationToken)
          return Promise.resolve({
            buckets: [
              {
                bucket: 'limit-bucket',
                continuation_token: 'large-next',
                files: firstPageFiles,
                is_truncated: true,
              },
            ],
          })
        if (query.continuationToken === 'large-next')
          return Promise.resolve({
            buckets: [
              {
                bucket: 'limit-bucket',
                continuation_token: null,
                files: [
                  {
                    id: 'large/file-201.txt',
                    name: 'file-201.txt',
                    type: 'file',
                  },
                ],
                is_truncated: false,
              },
            ],
          })
        throw new Error(`Unexpected S3 limit query: ${JSON.stringify(query)}`)
      },
    )

    renderSetup(s3Draft)

    await user.click(await screen.findByRole('button', { name: 'limit-bucket' }))
    const folder = await screen.findByRole('checkbox', { name: 'Large folder' })
    await user.click(folder)

    expect(await screen.findByText('dataset.newKnowledge.maxPages: 200')).toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.pagesSelected:{"count":0}', { exact: false }),
    ).toBeInTheDocument()
    expect(folder).toHaveAttribute('aria-checked', 'false')
    expect(folder).toHaveAttribute('aria-describedby', 'connected-source-selection-limit')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    expect(clientMock.createWorkflowImport).not.toHaveBeenCalled()
    expect(clientMock.getFiles).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', source_id: s3PreviewSource.id },
      query: {
        bucket: 'limit-bucket',
        continuationToken: 'large-next',
        maxKeys: 200,
        prefix: 'large/',
      },
    })
  })
})
