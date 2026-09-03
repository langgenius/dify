import type { Getter } from 'jotai'
import type { Source, SourceSyncPolicy, SourceWorkflowRun } from '../source-models'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import knowledgeSpaceTranslations from '@/i18n/en-US/knowledge-space.json'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { SourcesPage } from '../page'

vi.mock('../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

const toastInfoMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const permissionState = vi.hoisted(() => ({
  knowledgeSpacePermissionKeys: ['knowledge_space_document_write'],
  workspacePermissionKeys: ['dataset.acl.edit', 'dataset.external.connect'],
}))
vi.mock('../../space/context', () => ({
  useKnowledgeSpacePermission: (permission: string) =>
    permissionState.knowledgeSpacePermissionKeys.includes(permission),
}))
const sourceApiResponse = vi.hoisted(() => (source: Source) => ({
  sync_workflow: source.syncWorkflow
    ? {
        canceled_at: source.syncWorkflow.canceledAt ?? null,
        checkpoint: source.syncWorkflow.checkpoint,
        completed_at: source.syncWorkflow.completedAt ?? null,
        created_at: source.syncWorkflow.createdAt,
        cursor: source.syncWorkflow.cursor ?? null,
        execution_attempts: source.syncWorkflow.executionAttempts,
        id: source.syncWorkflow.id,
        knowledge_space_id: source.syncWorkflow.knowledgeSpaceId,
        kind: source.syncWorkflow.kind,
        last_error_code: source.syncWorkflow.lastErrorCode ?? null,
        max_execution_attempts: source.syncWorkflow.maxExecutionAttempts,
        progress_completed: source.syncWorkflow.progressCompleted,
        progress_failed: source.syncWorkflow.progressFailed,
        progress_skipped: source.syncWorkflow.progressSkipped,
        progress_total: source.syncWorkflow.progressTotal ?? null,
        source_id: source.syncWorkflow.sourceId ?? null,
        state: source.syncWorkflow.state,
        updated_at: source.syncWorkflow.updatedAt,
      }
    : null,
  connection_id: source.connectionId ?? null,
  created_at: source.createdAt,
  credential_configured: source.credentialConfigured ?? null,
  id: source.id,
  knowledge_space_id: source.knowledgeSpaceId,
  last_synced_at: source.lastSyncedAt ?? null,
  metadata: source.metadata,
  name: source.name,
  permission_scope: source.permissionScope ?? [],
  status: source.status,
  sync_policy: source.syncPolicy
    ? {
        created_at: source.syncPolicy.createdAt,
        custom_interval_seconds: source.syncPolicy.customIntervalSeconds ?? null,
        enabled: source.syncPolicy.enabled,
        expected_source_version: source.syncPolicy.expectedSourceVersion,
        id: source.syncPolicy.id,
        knowledge_space_id: source.syncPolicy.knowledgeSpaceId,
        mode: source.syncPolicy.mode,
        next_run_at: source.syncPolicy.nextRunAt ?? null,
        revision: source.syncPolicy.revision,
        source_id: source.syncPolicy.sourceId,
        updated_at: source.syncPolicy.updatedAt,
      }
    : null,
  type: source.type,
  updated_at: source.updatedAt,
  uri: source.uri,
  version: source.version ?? null,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: toastErrorMock, info: toastInfoMock },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => permissionState)
})

const datasourcePluginsQuery = vi.hoisted(() => ({
  data: [] as DataSourceItem[] | undefined,
  isError: false,
  isPending: false,
}))

vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: () => datasourcePluginsQuery,
}))

type SourcesInfiniteOptions = {
  getNextPageParam: (lastPage: { next_cursor?: string | null }) => string | null | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  refetchInterval: (query: {
    state: {
      data?: { pages: Array<{ data: ReturnType<typeof sourceApiResponse>[] }> }
    }
  }) => false | number
}

type ConnectionsInfiniteOptions = {
  input: (pageParam: string | null) => unknown
}

const sourcesQuery = vi.hoisted(() => ({
  data: undefined as { pages: Array<{ items: Source[]; nextCursor?: string }> } | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))
const jotaiQueryMocks = vi.hoisted(() => ({
  bump: undefined as undefined | (() => void),
}))
const connectionsQuery = vi.hoisted(() => ({
  data: undefined as
    | {
        pages: Array<{
          data: Array<{
            auth_kind: 'endpoint'
            configuration: Record<string, boolean | number | string>
            created_at: string
            id: string
            knowledge_space_id: string
            name: string
            provider_id: string
            scopes: string[]
            status: 'active'
            updated_at: string
            version: number
          }>
          next_cursor: null
        }>
      }
    | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isError: false,
  isFetchingNextPage: false,
  isPending: false,
}))

const infiniteOptionsMock = vi.hoisted(() => vi.fn((_options: SourcesInfiniteOptions) => ({})))
const connectionInfiniteOptionsMock = vi.hoisted(() =>
  vi.fn((_options: ConnectionsInfiniteOptions) => ({ scope: 'source-connections' })),
)
const clientMock = vi.hoisted(() => ({
  deleteSource: vi.fn(),
  deletePreviewJob: vi.fn(),
  getPreviewJob: vi.fn(),
  patchSource: vi.fn(),
  previewConnectedSource: vi.fn(),
  startPreviewJob: vi.fn(),
  retrySourceWorkflow: vi.fn(),
  syncSource: vi.fn(),
}))
const invalidateQueriesMock = vi.hoisted(() => vi.fn())
const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const navigationMock = vi.hoisted(() => ({ awaitInitialSource: null as string | null }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
  refetch: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: { scope?: string }) =>
      options.scope === 'source-connections'
        ? connectionsQuery
        : {
            ...sourcesQuery,
            data: sourcesQuery.data
              ? {
                  pages: sourcesQuery.data.pages.map((page) => ({
                    data: page.items.map(sourceApiResponse),
                    next_cursor: page.nextCursor ?? null,
                  })),
                }
              : undefined,
          },
    useQuery: () => ({
      data: {
        active_profile_available: settingsState.configurationState === 'active',
        active_profile_revisions:
          settingsState.configurationState === 'active' ? { embedding: 1, retrieval: 1 } : {},
        capabilities: {
          deep: settingsState.configurationState === 'active',
          index: settingsState.configurationState === 'active',
          ingest: settingsState.configurationState === 'active',
          query: settingsState.configurationState === 'active',
          research: settingsState.configurationState === 'active',
          source_sync: settingsState.configurationState === 'active',
        },
        configuration_state: settingsState.configurationState,
        embedding: null,
        issues: [],
        retrieval: null,
        revision: 1,
      },
      refetch: settingsState.refetch,
    }),
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  }
})
vi.mock('jotai-tanstack-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai-tanstack-query')>()
  const { atom, getDefaultStore } = await import('jotai/vanilla')
  const revisionAtom = atom(0)
  jotaiQueryMocks.bump = () =>
    getDefaultStore().set(revisionAtom, (revision: number) => revision + 1)

  return {
    ...original,
    atomWithInfiniteQuery: (getOptions: (get: Getter) => unknown) =>
      atom((get) => {
        get(revisionAtom)
        getOptions(get)
        return {
          ...sourcesQuery,
          data: sourcesQuery.data
            ? {
                pages: sourcesQuery.data.pages.map((page) => ({
                  data: page.items.map(sourceApiResponse),
                  next_cursor: page.nextCursor ?? null,
                })),
              }
            : undefined,
        }
      }),
  }
})
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/sources',
  useRouter: () => routerMock,
  useSearchParams: () => {
    const searchParams = new URLSearchParams()
    if (navigationMock.awaitInitialSource)
      searchParams.set('awaitInitialSource', navigationMock.awaitInitialSource)
    return searchParams
  },
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      sourceProviderPreview: {
        jobs: {
          byJobId: {
            delete: clientMock.deletePreviewJob,
            get: clientMock.getPreviewJob,
          },
          post: clientMock.startPreviewJob,
        },
        post: clientMock.previewConnectedSource,
      },
      spaces: {
        byControlSpaceId: {
          sources: {
            bySourceId: {
              delete: clientMock.deleteSource,
              patch: async (input: unknown) =>
                sourceApiResponse(await clientMock.patchSource(input)),
              sync: { post: clientMock.syncSource },
            },
            get: {
              infiniteOptions: infiniteOptionsMock,
              key: vi.fn(() => ['sources']),
            },
          },
          sourceWorkflows: {
            byRunId: {
              retry: { post: clientMock.retrySourceWorkflow },
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          settings: {
            get: {
              queryOptions: ({ input }: { input: unknown }) => ({
                queryKey: ['knowledge-fs', 'settings', input],
              }),
            },
          },
          sourceConnections: {
            get: {
              infiniteOptions: connectionInfiniteOptionsMock,
            },
          },
          sources: {
            get: {
              infiniteOptions: infiniteOptionsMock,
              key: vi.fn(() => ['sources']),
            },
          },
        },
      },
    },
  },
}))

function render(...args: Parameters<typeof renderWithNuqs>) {
  jotaiQueryMocks.bump?.()
  const rendered = renderWithNuqs(...args)
  const rerender = rendered.rerender
  return {
    ...rendered,
    rerender: (ui: Parameters<typeof rerender>[0]) => {
      jotaiQueryMocks.bump?.()
      rerender(ui)
    },
  }
}

const source = (overrides: Partial<Source>): Source => ({
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Product documentation',
  status: 'active',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.example.com',
  version: 3,
  ...overrides,
})

const firecrawlDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
          name: 'crawl',
          provider: 'firecrawl',
        },
        parameters: [
          {
            label: { en_US: 'Starting URL' },
            name: 'url',
            required: true,
            type: 'string',
          },
          {
            default: true,
            label: { en_US: 'Follow links' },
            name: 'crawl_subpages',
            required: false,
            type: 'boolean',
          },
          {
            default: 100,
            label: { en_US: 'Page cap' },
            max: 200,
            min: 1,
            name: 'limit',
            required: false,
            type: 'integer',
          },
          {
            label: { en_US: 'Included paths' },
            name: 'include_paths',
            required: false,
            type: 'string',
          },
        ],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      icon: 'icon.svg',
      label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      name: 'firecrawl',
      tags: [],
    },
    provider_type: 'website_crawl',
  },
  is_authorized: true,
  plugin_id: 'langgenius/firecrawl_datasource',
  plugin_unique_identifier: 'langgenius/firecrawl_datasource:1.0.0@local',
  provider: 'firecrawl',
}

const notionDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Notion', zh_Hans: 'Notion' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Notion', zh_Hans: 'Notion' },
          name: 'notion',
          provider: 'notion_datasource',
        },
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
    identity: {
      author: 'langgenius',
      description: { en_US: 'Notion', zh_Hans: 'Notion' },
      icon: 'icon.svg',
      label: { en_US: 'Notion', zh_Hans: 'Notion' },
      name: 'notion_datasource',
      tags: [],
    },
    provider_type: 'online_document',
  },
  is_authorized: true,
  plugin_id: 'langgenius/notion_datasource',
  plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
  provider: 'notion_datasource',
}

const googleDriveDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
          name: 'google_drive',
          provider: 'google_drive',
        },
        parameters: [
          {
            label: { en_US: 'Folder' },
            name: 'folder',
            required: true,
            type: 'string',
          },
        ],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      icon: 'icon.svg',
      label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      name: 'google_drive',
      tags: [],
    },
    provider_type: 'online_drive',
  },
  is_authorized: true,
  plugin_id: 'langgenius/google_drive',
  plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
  provider: 'google_drive',
}

const sourceConnectionResponse = {
  auth_kind: 'endpoint' as const,
  configuration: {
    credentialId: 'credential-1',
    datasource: 'crawl',
    pluginId: 'langgenius/firecrawl_datasource',
    provider: 'firecrawl',
    providerKind: 'website',
  },
  created_at: '2026-07-20T10:00:00Z',
  id: 'connection-1',
  knowledge_space_id: 'space-1',
  name: 'Firecrawl',
  provider_id: 'plugin-daemon-website',
  scopes: [],
  status: 'active' as const,
  updated_at: '2026-07-20T10:00:00Z',
  version: 1,
}

function useWebsitePreview(
  pages = [{ source_url: 'https://docs.example.com/guide', title: 'Guide' }],
) {
  connectionsQuery.data = { pages: [{ data: [sourceConnectionResponse], next_cursor: null }] }
  clientMock.startPreviewJob.mockResolvedValue({ job_id: 'preview-job-1' })
  clientMock.getPreviewJob.mockResolvedValue({
    result: { pages },
    status: 'completed',
  })
}

function useConnectedSourceConnection() {
  connectionsQuery.data = {
    pages: [
      {
        data: [
          {
            ...sourceConnectionResponse,
            configuration: {
              credentialId: 'credential-notion',
              datasource: 'notion',
              pluginId: 'langgenius/notion_datasource',
              provider: 'notion_datasource',
              providerKind: 'online-document',
            },
            id: 'connection-notion',
            name: 'Notion',
            provider_id: 'plugin-daemon-online-document',
          },
        ],
        next_cursor: null,
      },
    ],
  }
}

function useDriveSourceConnection() {
  connectionsQuery.data = {
    pages: [
      {
        data: [
          {
            ...sourceConnectionResponse,
            configuration: {
              credentialId: 'credential-drive',
              datasource: 'google_drive',
              pluginId: 'langgenius/google_drive',
              provider: 'google_drive',
              providerKind: 'online-drive',
            },
            id: 'connection-drive',
            name: 'Google Drive',
            provider_id: 'plugin-daemon-online-drive',
          },
        ],
        next_cursor: null,
      },
    ],
  }
}

const workflow = (state = 'queued') => ({
  canceled_at: null,
  checkpoint: 'sync',
  completed_at: null,
  created_at: '2026-07-20T10:00:00Z',
  execution_attempts: 1,
  id: 'workflow-1',
  kind: 'sync',
  knowledge_space_id: 'space-1',
  last_error_code: null,
  max_execution_attempts: 3,
  progress_completed: 0,
  progress_failed: 0,
  progress_skipped: 0,
  progress_total: 1,
  source_id: 'source-1',
  state,
  updated_at: '2026-07-20T10:00:00Z',
})

const sourceWorkflow = (state = 'queued'): SourceWorkflowRun => ({
  checkpoint: 'sync',
  createdAt: '2026-07-20T10:00:00Z',
  executionAttempts: 1,
  id: 'workflow-1',
  kind: 'sync',
  knowledgeSpaceId: 'space-1',
  maxExecutionAttempts: 3,
  progressCompleted: 0,
  progressFailed: 0,
  progressSkipped: 0,
  progressTotal: 1,
  sourceId: 'source-1',
  state,
  updatedAt: '2026-07-20T10:00:00Z',
})

function currentRefetchInterval(...sources: Source[]) {
  const options = infiniteOptionsMock.mock.lastCall?.[0]
  if (!options) throw new Error('Expected source infinite query options')
  return options.refetchInterval({
    state: { data: { pages: [{ data: sources.map(sourceApiResponse) }] } },
  })
}

describe('SourcesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sourcesQuery.data = undefined
    sourcesQuery.error = null
    sourcesQuery.hasNextPage = false
    sourcesQuery.isFetchNextPageError = false
    sourcesQuery.isFetchingNextPage = false
    sourcesQuery.isPending = false
    connectionsQuery.data = undefined
    connectionsQuery.error = null
    connectionsQuery.hasNextPage = false
    connectionsQuery.isError = false
    connectionsQuery.isFetchingNextPage = false
    connectionsQuery.isPending = false
    datasourcePluginsQuery.data = []
    datasourcePluginsQuery.isError = false
    datasourcePluginsQuery.isPending = false
    navigationMock.awaitInitialSource = null
    clientMock.deleteSource.mockResolvedValue({ status: 'accepted' })
    clientMock.deletePreviewJob.mockResolvedValue({ status: 'canceled' })
    clientMock.patchSource.mockResolvedValue(source({}))
    clientMock.retrySourceWorkflow.mockResolvedValue(workflow())
    invalidateQueriesMock.mockResolvedValue(undefined)
    clientMock.syncSource.mockResolvedValue(workflow())
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
    permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
    settingsState.configurationState = 'active'
    settingsState.refetch.mockImplementation(async () => ({
      data: {
        active_profile_available: settingsState.configurationState === 'active',
        active_profile_revisions:
          settingsState.configurationState === 'active' ? { embedding: 1, retrieval: 1 } : {},
        capabilities: {
          deep: settingsState.configurationState === 'active',
          index: settingsState.configurationState === 'active',
          ingest: settingsState.configurationState === 'active',
          query: settingsState.configurationState === 'active',
          research: settingsState.configurationState === 'active',
          source_sync: settingsState.configurationState === 'active',
        },
        configuration_state: settingsState.configurationState,
        embedding: null,
        issues: [],
        retrieval: null,
        revision: 1,
      },
      isError: false,
    }))
  })

  it('loads sources through the KnowledgeFS contract', () => {
    sourcesQuery.isPending = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(options.input(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: { limit: 200 },
    })
    expect(options.input('next')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'next', limit: 200 },
    })
    expect(options.getNextPageParam({ next_cursor: 'next' })).toBe('next')
    expect(options.initialPageParam).toBeNull()
    expect(
      options.refetchInterval({
        state: {
          data: { pages: [{ data: [sourceApiResponse(source({ status: 'syncing' }))] }] },
        },
      }),
    ).toBe(3000)
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [sourceApiResponse(source({ syncWorkflow: sourceWorkflow('completed') }))],
              },
            ],
          },
        },
      }),
    ).toBe(false)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('polls an empty list every two seconds while awaiting the Initial Source', () => {
    navigationMock.awaitInitialSource = 'operation-1'
    sourcesQuery.data = { pages: [{ items: [] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(currentRefetchInterval()).toBe(2000)
    expect(screen.getByText('knowledgeSpace.awaitingInitialSource')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.sourcesEmptyTitle')).not.toBeInTheDocument()
  })

  it('waits for the Initial Source created by the requested operation', () => {
    navigationMock.awaitInitialSource = 'operation-1'
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-source:older-operation',
                preview: false,
              },
              status: 'active',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(currentRefetchInterval(...sourcesQuery.data.pages[0]!.items)).toBe(2000)
    expect(screen.getByText('knowledgeSpace.awaitingInitialSource')).toBeInTheDocument()
  })

  it('clears the one-shot URL signal once the requested Initial Source appears', async () => {
    navigationMock.awaitInitialSource = 'operation-1'
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-website-source:operation-1',
                preview: true,
              },
              status: 'disabled',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/sources', {
        scroll: false,
      })
    })
  })

  it('stops awaiting the Initial Source after ten minutes and keeps manual refresh available', () => {
    vi.useFakeTimers()
    try {
      navigationMock.awaitInitialSource = 'operation-1'
      sourcesQuery.data = { pages: [{ items: [] }] }

      const view = render(<SourcesPage knowledgeSpaceId="space-1" />)
      act(() => vi.advanceTimersByTime(10 * 60 * 1000))

      expect(currentRefetchInterval()).toBe(false)

      act(() => screen.getByRole('button', { name: 'knowledgeSpace.refreshSources' }).click())
      expect(sourcesQuery.refetch).toHaveBeenCalledOnce()

      sourcesQuery.data = {
        pages: [
          {
            items: [
              source({
                metadata: {
                  clientRequestId: 'initial-source:operation-1',
                  preview: false,
                },
                status: 'active',
              }),
            ],
          },
        ],
      }
      view.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

      expect(
        screen.queryByRole('button', { name: 'knowledgeSpace.refreshSources' }),
      ).not.toBeInTheDocument()
      expect(currentRefetchInterval(...sourcesQuery.data.pages[0]!.items)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the designed empty state and exposes source-type shortcuts', () => {
    sourcesQuery.data = { pages: [{ items: [] }] }

    const { container } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSpace.sourcesEmptyTitle')).toBeInTheDocument()
    expect(knowledgeSpaceTranslations.sourcesEmptyDescription).toBe(
      'Connect a website, workspace, or drive — Dify keeps it synced and fresh, so retrieval never breaks.',
    )
    expect(screen.getByRole('heading', { name: 'knowledgeSpace.sources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'knowledgeSpace.addSource' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources/new',
    )
    for (const [name, path] of [
      ['Firecrawl', '/datasets/new/space-1/sources/new?type=websiteCrawl&provider=Firecrawl'],
      ['Jina Reader', '/datasets/new/space-1/sources/new?type=websiteCrawl&provider=Jina+Reader'],
      ['Notion', '/datasets/new/space-1/sources/new?type=onlineDocuments&provider=Notion'],
      ['Google Drive', '/datasets/new/space-1/sources/new?type=onlineDrive&provider=Google+Drive'],
      ['Confluence', '/datasets/new/space-1/sources/new?type=onlineDocuments&provider=Confluence'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', path)
    }
    expect(screen.getByRole('link', { name: 'knowledgeSpace.moreProviders' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources/new',
    )
    for (const [brand, iconClass] of [
      ['firecrawl', 'i-custom-public-common-firecrawl'],
      ['jina', 'i-custom-public-llm-jina'],
      ['notion', 'i-custom-public-common-notion'],
      ['google-drive', 'i-custom-public-common-google-drive'],
      ['confluence', 'i-custom-public-new-rag-confluence'],
      ['more', 'i-ri-more-fill'],
    ] as const) {
      const icon = container.querySelector(`[data-brand="${brand}"]`)
      expect(icon).toBeInTheDocument()
      expect(icon?.tagName).toBe('SPAN')
      expect(icon).toHaveClass(iconClass)
    }
  })

  it('keeps empty-state shortcuts inert without add-source permission', () => {
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourcesQuery.data = { pages: [{ items: [] }] }

    const { container } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-brand]')).toHaveLength(6)
  })

  it('renders real source statuses and filters by status and search text', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'active', name: 'Product documentation', status: 'active' }),
            source({
              syncWorkflow: { ...sourceWorkflow('syncing'), sourceId: 'syncing' },
              id: 'syncing',
              name: 'API reference',
              status: 'active',
            }),
            source({ id: 'disabled', name: 'Legacy FAQ', status: 'disabled' }),
            source({ id: 'error', name: 'Support site', status: 'error' }),
          ],
        },
      ],
    }

    const { onUrlUpdate } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSpace.sourceStatus.active')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.sourceStatus.syncing')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.sourceStatus.disabled')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.sourceStatus.error')).toBeInTheDocument()

    const sourceFilter = screen.getByRole('combobox', {
      name: 'knowledgeSpace.sourceFilterLabel',
    })
    await user.click(sourceFilter)
    await user.click(screen.getByRole('option', { name: 'knowledgeSpace.sourceStatus.error' }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('status')).toBe('error')
    })
    expect(screen.getByText('Support site')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.click(sourceFilter)
    await user.click(screen.getByRole('option', { name: 'knowledgeSpace.sourceStatus.syncing' }))
    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.click(sourceFilter)
    await user.click(screen.getByRole('option', { name: 'knowledgeSpace.allSources' }))
    await user.type(screen.getByRole('searchbox', { name: 'knowledgeSpace.searchSources' }), 'api')
    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.queryByText('Support site')).not.toBeInTheDocument()
  })

  it('sorts loaded sources by name from the source column header', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'zulu', name: 'Zulu docs' }),
            source({ id: 'alpha', name: 'Alpha docs' }),
          ],
        },
      ],
    }

    const { onUrlUpdate } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.sourceColumn' }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort')).toBe('name-asc')
    })
    const rowsAscending = screen.getAllByRole('row').slice(1)
    expect(within(rowsAscending[0]!).getByText('Alpha docs')).toBeInTheDocument()
    expect(within(rowsAscending[1]!).getByText('Zulu docs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.sourceColumn' }))
    const rowsDescending = screen.getAllByRole('row').slice(1)
    expect(within(rowsDescending[0]!).getByText('Zulu docs')).toBeInTheDocument()
    expect(within(rowsDescending[1]!).getByText('Alpha docs')).toBeInTheDocument()
  })

  it('places the newest source first until the user selects a name sort', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'older', name: 'Older source', createdAt: '2026-07-20T10:00:00Z' }),
            source({ id: 'newer', name: 'Newest source', createdAt: '2026-07-20T10:01:00Z' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Newest source')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Older source')).toBeInTheDocument()
  })

  it('keeps provisional crawl sources out of the source list', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              name: 'Discarded preview',
              status: 'disabled',
            }),
            source({ id: 'connected', name: 'Connected source' }),
            source({
              id: 'submitted-preview',
              metadata: { preview: true },
              name: 'Submitted preview',
              status: 'syncing',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('Discarded preview')).not.toBeInTheDocument()
    expect(screen.getByText('Connected source')).toBeInTheDocument()
    expect(screen.getByText('Submitted preview')).toBeInTheDocument()
  })

  it('shows Initial Sources as initializing or error while keeping ordinary previews hidden', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              id: 'ordinary-preview',
              metadata: { preview: true },
              name: 'Ordinary preview',
              status: 'disabled',
            }),
            source({
              id: 'empty-initial-request',
              metadata: { clientRequestId: 'initial-source:', preview: true },
              name: 'Incomplete Initial Source marker',
              status: 'disabled',
            }),
            source({
              id: 'initializing',
              metadata: {
                clientRequestId: 'initial-source:operation-1',
                preview: true,
              },
              name: 'Initial documents',
              status: 'disabled',
            }),
            source({
              id: 'syncing-initial-source',
              metadata: {
                clientRequestId: 'initial-website-source:operation-3',
                preview: true,
              },
              name: 'Syncing initial website',
              status: 'disabled',
              syncWorkflow: sourceWorkflow('importing'),
            }),
            source({
              id: 'failed',
              metadata: {
                clientRequestId: 'initial-website-source:operation-2',
                initialImport: { state: 'failed' },
                preview: false,
              },
              name: 'Initial website',
              status: 'disabled',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('Ordinary preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Incomplete Initial Source marker')).not.toBeInTheDocument()
    const initializingRow = screen.getByRole('row', { name: /Initial documents/ })
    expect(within(initializingRow).getByRole('status')).toHaveTextContent(
      'Initial documents: knowledgeSpace.sourceStatus.initializing',
    )
    const syncingRow = screen.getByRole('row', { name: /Syncing initial website/ })
    expect(within(syncingRow).getByRole('status')).toHaveTextContent(
      'Syncing initial website: knowledgeSpace.sourceStatus.syncing',
    )
    expect(
      within(syncingRow).getByText('knowledgeSpace.sourceSyncProgress:{"completed":0,"total":1}'),
    ).toBeInTheDocument()
    const failedRow = screen.getByRole('row', { name: /Initial website/ })
    expect(within(failedRow).getByText('knowledgeSpace.sourceStatus.error')).toBeInTheDocument()

    expect(
      currentRefetchInterval(
        source({
          metadata: {
            clientRequestId: 'initial-source:operation-1',
            preview: true,
          },
          status: 'disabled',
        }),
      ),
    ).toBe(3000)
    expect(
      currentRefetchInterval(
        source({
          metadata: {
            clientRequestId: 'initial-source:operation-1',
            preview: false,
          },
          status: 'active',
        }),
      ),
    ).toBe(false)
    expect(
      currentRefetchInterval(
        source({
          metadata: {
            clientRequestId: 'initial-website-source:operation-2',
            initialImport: { state: 'failed' },
            preview: false,
          },
          status: 'disabled',
        }),
      ),
    ).toBe(false)

    await user.click(
      within(initializingRow).getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Initial documents"}',
      }),
    )
    expect(screen.getByRole('menuitem', { name: 'knowledgeSpace.openSource' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.edit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.removeSource' }),
    ).not.toBeInTheDocument()
  })

  it('retries the failed Initial Source workflow instead of starting a generic sync', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-source:operation-1',
                initialImport: {
                  state: 'failed',
                  workflowId: 'initial-workflow',
                },
                preview: false,
              },
              name: 'Failed Initial Source',
              status: 'disabled',
            }),
          ],
        },
      ],
    }
    clientMock.retrySourceWorkflow.mockResolvedValue({
      ...workflow(),
      id: 'initial-workflow',
    })

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const sourceRow = screen.getByRole('row', { name: /Failed Initial Source/ })
    await user.click(within(sourceRow).getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => {
      expect(within(sourceRow).getByRole('status')).toHaveTextContent(
        'knowledgeSpace.sourceStatus.syncing',
      )
    })
    expect(
      within(sourceRow).queryByRole('button', { name: 'common.operation.retry' }),
    ).not.toBeInTheDocument()
    expect(clientMock.retrySourceWorkflow).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'initial-workflow' },
    })
    expect(clientMock.syncSource).not.toHaveBeenCalled()

    await user.click(
      within(sourceRow).getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Failed Initial Source"}',
      }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.syncNow' }),
    ).not.toBeInTheDocument()
  })

  it('retries a failed async import workflow instead of starting a generic sync', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                lastImport: {
                  kind: 'online-document-import',
                  state: 'failed',
                  syncPolicy: { enabled: true, mode: 'interval' },
                  workflowId: 'import-workflow',
                },
                preview: false,
              },
              name: 'Failed connected source',
              status: 'error',
            }),
          ],
        },
      ],
    }
    clientMock.retrySourceWorkflow.mockResolvedValue({
      ...workflow(),
      execution_attempts: 2,
      updated_at: '2026-07-20T10:01:00Z',
    })

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const sourceRow = screen.getByRole('row', { name: /Failed connected source/ })
    await user.click(
      within(sourceRow).getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Failed connected source"}',
      }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.syncNow' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.retry' }))

    await waitFor(() => expect(clientMock.retrySourceWorkflow).toHaveBeenCalledOnce())
    expect(clientMock.retrySourceWorkflow).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'import-workflow' },
    })
    expect(clientMock.syncSource).not.toHaveBeenCalled()
    expect(within(sourceRow).getByRole('status')).toHaveTextContent(
      'knowledgeSpace.sourceStatus.syncing',
    )
  })

  it('shows and polls an accepted async import even when the source status is briefly disabled', () => {
    const pendingSource = source({
      metadata: {
        pendingImport: {
          kind: 'online-document-import',
          syncPolicy: { enabled: true, mode: 'interval' },
          workflowId: 'import-workflow',
        },
        preview: false,
      },
      name: 'Importing connected source',
      status: 'disabled',
    })
    sourcesQuery.data = { pages: [{ items: [pendingSource] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const sourceRow = screen.getByRole('row', { name: /Importing connected source/ })
    expect(within(sourceRow).getByRole('status')).toHaveTextContent(
      'knowledgeSpace.sourceStatus.syncing',
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [{ data: [sourceApiResponse(pendingSource)] }],
          },
        },
      }),
    ).toBe(3000)
  })

  it('keeps polling when the source list briefly returns the stale failed retry snapshot', async () => {
    const user = userEvent.setup()
    const staleFailedWorkflow: SourceWorkflowRun = {
      ...sourceWorkflow('failed'),
      executionAttempts: 1,
      id: 'initial-workflow',
      lastErrorCode: 'SOURCE_WORKFLOW_FAILED',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const staleFailedSource = source({
      metadata: {
        clientRequestId: 'initial-source:operation-1',
        initialImport: {
          state: 'failed',
          workflowId: 'initial-workflow',
        },
        preview: false,
      },
      name: 'Failed Initial Source',
      status: 'disabled',
      syncWorkflow: staleFailedWorkflow,
    })
    sourcesQuery.data = { pages: [{ items: [staleFailedSource] }] }
    clientMock.retrySourceWorkflow.mockResolvedValue({
      ...workflow(),
      execution_attempts: 2,
      id: 'initial-workflow',
      updated_at: '2026-07-20T10:01:00Z',
    })

    const view = render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.sourceStatus.syncing')
    })

    sourcesQuery.data = { pages: [{ items: [staleFailedSource] }] }
    view.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(currentRefetchInterval(staleFailedSource)).toBe(3000)
  })

  it('continues past cursor pages containing only hidden preview drafts', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              status: 'disabled',
            }),
          ],
          nextCursor: 'next',
        },
      ],
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.queryByText('knowledgeSpace.sourcesEmptyTitle')).not.toBeInTheDocument()
  })

  it('continues when the newest loaded page contributes only hidden preview drafts', () => {
    sourcesQuery.data = {
      pages: [
        { items: [source({ id: 'connected', name: 'Connected source' })] },
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              status: 'disabled',
            }),
          ],
          nextCursor: 'next',
        },
      ],
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Connected source')).toBeInTheDocument()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('opens a source URI from the row action menu', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )

    const openSource = screen.getByRole('menuitem', {
      name: 'knowledgeSpace.openSource',
    })
    expect(openSource).toHaveAttribute('href', 'https://docs.example.com')
    expect(openSource).toHaveAttribute('target', '_blank')
    expect(openSource).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens an Amazon S3 source in the AWS console for read-only users', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              type: 'object-storage',
              uri: 's3://private-bucket/Product%20documentation/文档',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(screen.getByRole('menuitem', { name: 'knowledgeSpace.openSource' })).toHaveAttribute(
      'href',
      'https://s3.console.aws.amazon.com/s3/buckets/private-bucket?prefix=Product+documentation%2F%E6%96%87%E6%A1%A3',
    )
  })

  it('uses knowledge-space document-write permission for every source mutation action', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.external.connect']
    permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'knowledgeSpace.removeSource' }),
    ).toBeInTheDocument()
  })

  it('hides source mutations without knowledge-space document-write permission', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.create_and_management']
    permissionState.knowledgeSpacePermissionKeys = []
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(screen.getByRole('menuitem', { name: 'knowledgeSpace.openSource' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.edit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.removeSource' }),
    ).not.toBeInTheDocument()
  })

  it('edits a source name and sync policy from the row menu', async () => {
    const user = userEvent.setup()
    const manualPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: false,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'manual',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const dailyPolicy: SourceSyncPolicy = {
      ...manualPolicy,
      enabled: true,
      expectedSourceVersion: 4,
      mode: 'interval',
      revision: 2,
      updatedAt: '2026-07-20T10:01:00Z',
    }
    sourcesQuery.data = {
      pages: [{ items: [source({ syncPolicy: manualPolicy, type: 'upload', uri: 'upload://1' })] }],
    }
    clientMock.patchSource.mockResolvedValue(
      source({
        name: 'Renamed documentation',
        syncPolicy: dailyPolicy,
        type: 'upload',
        version: 4,
      }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const nameInput = screen.getByRole('textbox', {
      name: 'knowledgeSpace.sourceName',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed documentation')
    await user.click(screen.getByRole('combobox', { name: 'knowledgeSpace.syncPolicy' }))
    await user.click(screen.getByRole('option', { name: 'knowledgeSpace.syncPolicyDaily' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Renamed documentation',
          syncPolicy: { enabled: true, mode: 'interval' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(screen.getByRole('row', { name: /Renamed documentation/ })).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Renamed documentation/ })).getByText(
        'knowledgeSpace.syncPolicyDaily',
      ),
    ).toBeInTheDocument()
  })

  it('edits website source parameters from the row menu', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [firecrawlDatasourcePlugin]
    useWebsitePreview([
      { source_url: 'https://handbook.example.com/getting-started', title: 'Getting started' },
    ])
    const websiteSource = source({
      connectionId: 'connection-1',
      metadata: {
        crawlOptions: { includeSubpages: true, limit: 100 },
        parameters: {
          url: 'https://docs.example.com/',
        },
        providerId: 'plugin-daemon-website',
        providerName: 'Firecrawl',
      },
      uri: 'https://docs.example.com/',
    })
    sourcesQuery.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        metadata: {
          ...websiteSource.metadata,
          crawlOptions: { includeSubpages: true, limit: 50 },
          parameters: {
            crawl_subpages: true,
            limit: 50,
            url: 'https://handbook.example.com/',
          },
        },
        uri: 'https://handbook.example.com/',
        version: 4,
      }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const rootUrl = screen.getByRole('textbox', { name: 'Starting URL' })
    expect(rootUrl).toHaveValue('https://docs.example.com/')
    await user.clear(rootUrl)
    await user.type(rootUrl, 'https://handbook.example.com')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlOptions' }))
    expect(screen.getByRole('checkbox', { name: 'Follow links' })).toBeChecked()
    const maxPages = screen.getByRole('spinbutton', {
      name: 'Page cap',
    })
    expect(maxPages).toHaveValue(100)
    await user.clear(maxPages)
    await user.type(maxPages, '50')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: /Getting started/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: {
            crawl_subpages: true,
            limit: 50,
            url: 'https://handbook.example.com',
          },
          selection: {
            kind: 'website_crawl',
            sourceUrls: ['https://handbook.example.com/getting-started'],
          },
          syncPolicy: { enabled: false, mode: 'manual' },
          uri: 'https://handbook.example.com/',
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('submits an online document selection in the source PATCH', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [notionDatasourcePlugin]
    useConnectedSourceConnection()
    clientMock.previewConnectedSource.mockResolvedValue({
      documents: [
        {
          last_edited_time: '2026-08-30T10:00:00Z',
          name: 'Product plan',
          page_id: 'page-1',
          provider_item_id: 'opaque-provider-page-1',
          type: 'page',
          workspace_id: 'workspace-1',
          workspace_name: 'Product',
        },
      ],
      next_page_parameters: null,
    })
    const connectorSource = source({
      connectionId: 'connection-notion',
      metadata: {
        parameters: { workspace: 'product' },
        providerId: 'plugin-daemon-online-document',
        providerKind: 'online-document',
        providerName: 'Notion',
      },
      type: 'connector',
      uri: 'notion://connection-notion',
    })
    sourcesQuery.data = { pages: [{ items: [connectorSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        ...connectorSource,
        status: 'syncing',
        syncWorkflow: sourceWorkflow(),
        version: 4,
      }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Product plan' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: { workspace: 'product' },
          selection: {
            items: [
              {
                lastEditedTime: '2026-08-30T10:00:00Z',
                name: 'Product plan',
                pageId: 'page-1',
                providerItemId: 'opaque-provider-page-1',
                type: 'page',
                workspaceId: 'workspace-1',
              },
            ],
            kind: 'online_document',
          },
          syncPolicy: { enabled: false, mode: 'manual' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(clientMock.previewConnectedSource).toHaveBeenCalledWith({
      body: {
        credentialId: 'credential-notion',
        datasource: 'notion',
        kind: 'online_document',
        parameters: { workspace: 'product' },
        pluginId: 'langgenius/notion_datasource',
        provider: 'notion_datasource',
      },
    })
  })

  it('submits an online drive selection with the provider resource identity', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [googleDriveDatasourcePlugin]
    useDriveSourceConnection()
    clientMock.previewConnectedSource.mockResolvedValue({
      files: [
        {
          bucket: 'project-files',
          id: 'file-1',
          mime_type: 'application/pdf',
          name: 'Project plan.pdf',
          provider_item_id: 'opaque-provider-file-1',
          size: 1024,
          type: 'application/pdf',
        },
      ],
      next_page_parameters: null,
    })
    const connectorSource = source({
      connectionId: 'connection-drive',
      metadata: {
        parameters: { folder: 'project-a' },
        providerId: 'plugin-daemon-online-drive',
        providerKind: 'online-drive',
        providerName: 'Google Drive',
      },
      type: 'connector',
      uri: 'gdrive://connection-drive',
    })
    sourcesQuery.data = { pages: [{ items: [connectorSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({ ...connectorSource, status: 'syncing', syncWorkflow: sourceWorkflow(), version: 4 }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Project plan.pdf' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: { folder: 'project-a' },
          selection: {
            items: [
              {
                bucket: 'project-files',
                id: 'file-1',
                mimeType: 'application/pdf',
                name: 'Project plan.pdf',
                providerItemId: 'opaque-provider-file-1',
              },
            ],
            kind: 'online_drive',
          },
          syncPolicy: { enabled: false, mode: 'manual' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('requires a current website preview selection before saving', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [firecrawlDatasourcePlugin]
    useWebsitePreview()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              connectionId: 'connection-1',
              metadata: {
                datasourceParameterMode: 'exact',
                parameters: { url: 'https://docs.example.com/' },
                providerName: 'Firecrawl',
              },
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlOptions' }))

    const followLinks = screen.getByRole('checkbox', { name: 'Follow links' })
    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    expect(followLinks).toBeChecked()
    expect(saveButton).toBeDisabled()

    await user.click(followLinks)
    expect(saveButton).toBeDisabled()
    await user.click(followLinks)
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: /Guide/ }))
    expect(saveButton).toBeEnabled()
  })

  it('keeps the opening edit snapshot when the source refreshes in the background', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [firecrawlDatasourcePlugin]
    const manualPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: false,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'manual',
      revision: 5,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const websiteSource = source({
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: { limit: 100, url: 'https://docs.example.com/' },
        providerName: 'Firecrawl',
      },
      syncPolicy: manualPolicy,
      type: 'upload',
      uri: 'upload://1',
    })
    sourcesQuery.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({ name: 'Renamed documentation', syncPolicy: manualPolicy, version: 4 }),
    )

    const { rerender } = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                datasourceParameterMode: 'exact',
                parameters: { limit: 80, url: 'https://docs.example.com/' },
                providerName: 'Firecrawl',
              },
              syncPolicy: { ...manualPolicy, revision: 6 },
              type: 'upload',
              uri: 'upload://1',
              version: 4,
            }),
          ],
        },
      ],
    }
    rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    const nameInput = screen.getByRole('textbox', { name: 'knowledgeSpace.sourceName' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed documentation')
    await user.click(screen.getByRole('combobox', { name: 'knowledgeSpace.syncPolicy' }))
    await user.click(screen.getByRole('option', { name: 'knowledgeSpace.syncPolicyDaily' }))
    await user.click(saveButton)

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Renamed documentation',
          syncPolicy: { enabled: true, mode: 'interval' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('removes a cleared optional website provider parameter', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = [firecrawlDatasourcePlugin]
    useWebsitePreview()
    const websiteSource = source({
      connectionId: 'connection-1',
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: {
          include_paths: '/private/**',
          url: 'https://docs.example.com/',
        },
        providerName: 'Firecrawl',
      },
      uri: 'https://docs.example.com/',
    })
    sourcesQuery.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        metadata: {
          ...websiteSource.metadata,
          parameters: {
            crawl_subpages: true,
            limit: 100,
            url: 'https://docs.example.com/',
          },
        },
        version: 4,
      }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlOptions' }))
    const includedPaths = screen.getByRole('textbox', { name: 'Included paths' })
    expect(includedPaths).toHaveValue('/private/**')
    await user.clear(includedPaths)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: /Guide/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: {
            crawl_subpages: true,
            limit: 100,
            url: 'https://docs.example.com/',
          },
          selection: {
            kind: 'website_crawl',
            sourceUrls: ['https://docs.example.com/guide'],
          },
          syncPolicy: { enabled: false, mode: 'manual' },
          uri: 'https://docs.example.com/',
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('does not expose legacy website fields while a provider declaration is loading', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = undefined
    datasourcePluginsQuery.isPending = true
    const websiteSource = source({
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: { url: 'https://docs.example.com/' },
        providerName: 'Firecrawl',
      },
    })
    sourcesQuery.data = { pages: [{ items: [websiteSource] }] }
    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSpace.rootUrl' }),
    ).not.toBeInTheDocument()
    const nameInput = screen.getByRole('textbox', {
      name: 'knowledgeSpace.sourceName',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed documentation')
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  })

  it('reports provider declaration failures without falling back to legacy fields', async () => {
    const user = userEvent.setup()
    datasourcePluginsQuery.data = undefined
    datasourcePluginsQuery.isError = true
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                datasourceParameterMode: 'exact',
                parameters: { url: 'https://docs.example.com/' },
                providerName: 'Firecrawl',
              },
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    expect(screen.getByRole('alert')).toHaveTextContent('knowledgeSpace.providerLoadFailed')
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSpace.rootUrl' }),
    ).not.toBeInTheDocument()
  })

  it('loads edit connections with the current control space instead of the remote space id', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              connectionId: 'connection-1',
              knowledgeSpaceId: 'remote-space-1',
              metadata: { providerKind: 'online-document' },
              type: 'connector',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="control-space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const options = connectionInfiniteOptionsMock.mock.calls.at(-1)?.[0]
    expect(options?.input(null)).toEqual({
      params: { control_space_id: 'control-space-1' },
      query: { limit: 200 },
    })
  })

  it('syncs a source through the real KnowledgeFS action', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    let finishRefresh: (() => void) | undefined
    invalidateQueriesMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    const { rerender } = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )

    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    await waitFor(() =>
      expect(clientMock.syncSource).toHaveBeenCalledWith({
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceSyncProgress:{"completed":0,"total":1}',
      ),
    ).toBeInTheDocument()
    finishRefresh?.()
    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    rerender(<SourcesPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.active',
        ),
      ).toBeInTheDocument(),
    )
    await waitFor(() => expect(invalidateQueriesMock).toHaveBeenCalledTimes(1))
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [sourceApiResponse(source({ syncWorkflow: sourceWorkflow('completed') }))],
              },
            ],
          },
        },
      }),
    ).toBe(false)
    expect(invalidateQueriesMock).toHaveBeenLastCalledWith(
      { queryKey: ['sources'] },
      { throwOnError: true },
    )
  })

  it('restores an active source sync from the server on page load', async () => {
    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('syncing') })] }],
    }
    const restored = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()

    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    restored.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.active',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('keeps a disabled source disabled while its sync is active', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              status: 'disabled',
              syncWorkflow: sourceWorkflow('syncing'),
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Product documentation/ })
    expect(within(row).getByText('knowledgeSpace.sourceStatus.disabled')).toBeInTheDocument()
    expect(within(row).queryByText('knowledgeSpace.sourceStatus.syncing')).not.toBeInTheDocument()

    await user.click(
      within(row).getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    expect(within(row).getByText('knowledgeSpace.sourceStatus.disabled')).toBeInTheDocument()
    expect(within(row).queryByText('knowledgeSpace.sourceStatus.syncing')).not.toBeInTheDocument()

    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [
                  sourceApiResponse(
                    source({ status: 'disabled', syncWorkflow: sourceWorkflow('syncing') }),
                  ),
                ],
              },
            ],
          },
        },
      }),
    ).toBe(3000)
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [
                  sourceApiResponse(
                    source({ status: 'disabled', syncWorkflow: sourceWorkflow('completed') }),
                  ),
                ],
              },
            ],
          },
        },
      }),
    ).toBe(false)
  })

  it('keeps polling an active sync when enabling a disabled source and refresh fails', async () => {
    const user = userEvent.setup()
    const activeWorkflow = sourceWorkflow('syncing')
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              status: 'disabled',
              syncWorkflow: activeWorkflow,
            }),
          ],
        },
      ],
    }
    clientMock.patchSource.mockResolvedValue(
      source({
        status: 'active',
        updatedAt: '2026-07-20T10:01:00Z',
        version: 4,
      }),
    )
    invalidateQueriesMock.mockRejectedValueOnce(new Error('Source refresh failed'))

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const row = screen.getByRole('row', { name: /Product documentation/ })
    await user.click(
      within(row).getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))

    await waitFor(() =>
      expect(within(row).getByText('knowledgeSpace.sourceStatus.syncing')).toBeInTheDocument(),
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [
                  sourceApiResponse(source({ status: 'disabled', syncWorkflow: activeWorkflow })),
                ],
              },
            ],
          },
        },
      }),
    ).toBe(3000)
  })

  it('keeps a failed restored sync visible when the source list reaches a terminal state', async () => {
    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('syncing') })] }],
    }
    const restored = render(<SourcesPage knowledgeSpaceId="space-1" />)

    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              lastSyncedAt: '2026-07-20T09:00:00Z',
              syncWorkflow: {
                ...sourceWorkflow('failed'),
                lastErrorCode: 'PROVIDER_FAILED',
              },
            }),
          ],
        },
      ],
    }
    restored.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Product documentation/ })
    await waitFor(() =>
      expect(
        within(row).getByRole('button', {
          name: 'knowledgeSpace.taskFailure.temporary',
        }),
      ).toBeInTheDocument(),
    )
    expect(within(row).queryByText('PROVIDER_FAILED')).not.toBeInTheDocument()
    expect(invalidateQueriesMock).not.toHaveBeenCalled()
  })

  it('reconciles the source list after a sync finishes', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    invalidateQueriesMock.mockImplementationOnce((_filters, options) =>
      options?.throwOnError
        ? Promise.reject(new Error('Initial source refresh failed'))
        : Promise.resolve(),
    )

    const rendered = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()

    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(invalidateQueriesMock).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      const options = infiniteOptionsMock.mock.lastCall?.[0]
      expect(options).toBeDefined()
      if (!options) throw new Error('Expected source infinite query options')
      expect(
        options.refetchInterval({
          state: {
            data: {
              pages: [
                {
                  data: [sourceApiResponse(source({ syncWorkflow: sourceWorkflow('completed') }))],
                },
              ],
            },
          },
        }),
      ).toBe(false)
    })
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.active',
      ),
    ).toBeInTheDocument()
  })

  it('tracks a newer server workflow after a local sync completes', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    const rendered = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.active',
        ),
      ).toBeInTheDocument(),
    )

    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              syncWorkflow: { ...sourceWorkflow('syncing'), id: 'workflow-2' },
            }),
          ],
        },
      ],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.syncing',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('replaces a local active sync with a newer terminal server workflow', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    const rendered = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.syncing',
        ),
      ).toBeInTheDocument(),
    )

    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              syncWorkflow: {
                ...sourceWorkflow('completed'),
                createdAt: '2026-07-20T11:00:00Z',
                id: 'workflow-2',
                updatedAt: '2026-07-20T11:01:00Z',
              },
            }),
          ],
        },
      ],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.active',
        ),
      ).toBeInTheDocument(),
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [
                  sourceApiResponse(
                    source({
                      syncWorkflow: {
                        ...sourceWorkflow('completed'),
                        createdAt: '2026-07-20T11:00:00Z',
                        id: 'workflow-2',
                        updatedAt: '2026-07-20T11:01:00Z',
                      },
                    }),
                  ),
                ],
              },
            ],
          },
        },
      }),
    ).toBe(false)
  })

  it('tracks an older workflow when the server has retried it', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    clientMock.syncSource.mockResolvedValue({
      ...workflow('completed'),
      created_at: '2026-07-20T11:00:00Z',
      id: 'newer-terminal-workflow',
      updated_at: '2026-07-20T11:01:00Z',
    })

    const rendered = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    const retriedWorkflow = {
      ...sourceWorkflow('syncing'),
      createdAt: '2026-07-20T09:00:00Z',
      id: 'older-retried-workflow',
      updatedAt: '2026-07-20T12:00:00Z',
    }
    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: retriedWorkflow })] }],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.syncing',
        ),
      ).toBeInTheDocument(),
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [sourceApiResponse(source({ syncWorkflow: retriedWorkflow }))],
              },
            ],
          },
        },
      }),
    ).toBe(3000)
  })

  it('keeps a newly accepted sync visible when the source list still has an older workflow', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    clientMock.syncSource.mockResolvedValue({
      ...workflow(),
      created_at: '2026-07-20T11:00:00Z',
      id: 'workflow-2',
      updated_at: '2026-07-20T11:00:00Z',
    })
    invalidateQueriesMock.mockRejectedValueOnce(new Error('Source refresh failed'))

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.sourceStatus.syncing',
        ),
      ).toBeInTheDocument(),
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [sourceApiResponse(source({ syncWorkflow: sourceWorkflow('completed') }))],
              },
            ],
          },
        },
      }),
    ).toBe(3000)
  })

  it('prompts for model setup before syncing a source', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.syncNow' }))

    expect(clientMock.syncSource).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', {
      name: 'knowledgeSpace.overview.attention.modelReadiness.title',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'common.modelProvider.selector.configure',
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith(
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fsources&capability=source_sync',
    )
  })

  it('disables and re-enables a source through the real patch endpoint', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'active-source', name: 'Active source' }),
            source({ id: 'disabled', name: 'Disabled source', status: 'disabled' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const activeSourceActions = within(
      screen.getByRole('row', { name: /Active source/ }),
    ).getByRole('button', { name: /knowledgeSpace.sourceActions/ })
    const disabledSourceActions = within(
      screen.getByRole('row', { name: /Disabled source/ }),
    ).getByRole('button', { name: /knowledgeSpace.sourceActions/ })
    await user.click(activeSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }))
    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: { expectedVersion: 3, status: 'disabled' },
        params: { control_space_id: 'space-1', source_id: 'active-source' },
      }),
    )

    await user.click(disabledSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))
    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3, status: 'active' },
        params: { control_space_id: 'space-1', source_id: 'disabled' },
      }),
    )
  })

  it('uses the returned source version while a workflow-enriched list replica is stale', async () => {
    const user = userEvent.setup()
    const syncPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      customIntervalSeconds: 86400,
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    sourcesQuery.data = {
      pages: [{ items: [source({ syncPolicy, syncWorkflow: sourceWorkflow('failed') })] }],
    }
    invalidateQueriesMock.mockRejectedValue(new Error('Source refresh failed'))
    clientMock.patchSource
      .mockResolvedValueOnce(
        source({
          status: 'disabled',
          updatedAt: '2026-07-20T10:01:00Z',
          version: 4,
        }),
      )
      .mockResolvedValueOnce(
        source({
          status: 'active',
          updatedAt: '2026-07-20T10:02:00Z',
          version: 5,
        }),
      )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }))

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.disabled',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.syncPolicyDaily',
      ),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenLastCalledWith({
        body: { expectedVersion: 4, status: 'active' },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('uses fresh list enrichment after an optimistic source update catches up', async () => {
    const user = userEvent.setup()
    const dailyPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const updatedSource = source({
      status: 'disabled',
      updatedAt: '2026-07-20T10:01:00Z',
      version: 4,
    })
    sourcesQuery.data = { pages: [{ items: [source({ syncPolicy: dailyPolicy })] }] }
    clientMock.patchSource.mockResolvedValue(updatedSource)

    const view = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'knowledgeSpace.syncPolicyDaily',
        ),
      ).toBeInTheDocument(),
    )

    sourcesQuery.data = {
      pages: [
        {
          items: [
            {
              ...updatedSource,
              lastSyncedAt: '2026-07-20T10:02:00Z',
              syncPolicy: {
                ...dailyPolicy,
                enabled: false,
                expectedSourceVersion: 4,
                mode: 'manual',
                revision: 2,
                updatedAt: '2026-07-20T10:02:00Z',
              },
            },
          ],
        },
      ],
    }
    view.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Product documentation/ })
    expect(within(row).getByText('knowledgeSpace.syncPolicyManual')).toBeInTheDocument()
    expect(within(row).queryByText('knowledgeSpace.syncPolicyDaily')).not.toBeInTheDocument()
    expect(within(row).queryByText('—')).not.toBeInTheDocument()
  })

  it('requires confirmation before removing a source', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.removeSource' }))

    expect(clientMock.deleteSource).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.removeSource' }))
    await waitFor(() =>
      expect(clientMock.deleteSource).toHaveBeenCalledWith({
        body: { expectedRevision: 3 },
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
        query: { documents: 'keep' },
      }),
    )
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()
  })

  it('keeps the removal confirmation open when the request fails', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    clientMock.deleteSource.mockRejectedValue(new Error('temporary failure'))

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'knowledgeSpace.removeSource' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.removeSource' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('knowledgeSpace.sourcesErrorDescription'),
    )
    expect(screen.getByRole('button', { name: 'knowledgeSpace.removeSource' })).toBeInTheDocument()
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['sources'] })
  })

  it('retries an errored source and shows its queued state', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({ status: 'error' })] }] }
    let finishRefresh: (() => void) | undefined
    invalidateQueriesMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(clientMock.syncSource).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'knowledgeSpace.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    finishRefresh?.()
  })

  it('supports row selection and a true indeterminate select-all state', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [{ items: [source({ id: 'first' }), source({ id: 'second' })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    const selectAll = checkboxes[0]
    const firstSource = checkboxes[1]
    const secondSource = checkboxes[2]
    if (!selectAll || !firstSource || !secondSource) throw new Error('Expected source checkboxes')
    await user.click(firstSource)
    expect(selectAll).toHaveAttribute('data-indeterminate')

    await user.click(selectAll)
    expect(firstSource).toBeChecked()
    expect(secondSource).toBeChecked()
  })

  it('offers a real retry when the source list cannot load', async () => {
    const user = userEvent.setup()
    sourcesQuery.error = new Error('temporary failure')

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(sourcesQuery.refetch).toHaveBeenCalledOnce()
  })

  it('loads the next real cursor page on demand', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('continues from an empty cursor page when a later page exists', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('knowledgeSpace.sourcesEmptyTitle')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('continues through cursor pages before declaring a filtered search empty', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'knowledgeSpace.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.queryByText('knowledgeSpace.noMatchingSources')).not.toBeInTheDocument()
  })

  it('stops automatic filtered pagination at the page cap and offers manual loading', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: Array.from({ length: 5 }, (_, index) => ({
        items: [source({ id: `source-${index}`, name: `Source ${index}` })],
        nextCursor: `cursor-${index + 1}`,
      })),
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'knowledgeSpace.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('stops automatic filtered pagination after a cursor error', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true
    sourcesQuery.isFetchNextPageError = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'knowledgeSpace.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.noMatchingSources')).not.toBeInTheDocument()
  })

  it('shows provider and source type as separate row details', () => {
    sourcesQuery.data = {
      pages: [{ items: [source({ metadata: { providerName: 'Firecrawl' } })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Firecrawl')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.sourceType.web')).toBeInTheDocument()
  })

  it('restores legacy website provider metadata and shows policy and last sync details', () => {
    const syncPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      customIntervalSeconds: 86400,
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              lastSyncedAt: '2026-07-20T10:00:00Z',
              metadata: {
                preview: false,
                providerId: 'plugin-daemon-website-firecrawl',
              },
              syncPolicy,
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Product documentation/ })
    expect(within(row).getByText('Firecrawl')).toBeInTheDocument()
    expect(within(row).getByText('knowledgeSpace.syncPolicyDaily')).toBeInTheDocument()
    expect(within(row).queryByText('—')).not.toBeInTheDocument()
  })

  it('restores a legacy Notion provider identifier as the designed provider details', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: { providerName: 'notion_datasource' },
              name: 'Notion support SOP',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Notion support SOP/ })
    expect(within(row).getByText('Notion')).toBeInTheDocument()
    expect(within(row).getByText('knowledgeSpace.onlineDocuments')).toBeInTheDocument()
    expect(within(row).queryByText('notion_datasource')).not.toBeInTheDocument()
  })

  it('preserves a custom provider name containing a built-in brand', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                providerKind: 'online-document',
                providerName: 'Notion Backup',
              },
              name: 'Archived workspace',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Archived workspace/ })
    expect(within(row).getByText('Notion Backup')).toBeInTheDocument()
    expect(within(row).queryByText('Notion')).not.toBeInTheDocument()
  })

  it('uses provider kind to distinguish legacy Google Drive sources', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                providerKind: 'online-drive',
                providerName: 'google_drive',
              },
              name: 'Escalation archive',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Escalation archive/ })
    expect(within(row).getByText('Google Drive')).toBeInTheDocument()
    expect(within(row).getByText('knowledgeSpace.onlineDrive')).toBeInTheDocument()
  })

  it('restores the OneDrive name, type, and brand icon', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              metadata: { providerName: 'microsoft_onedrive' },
              name: 'Sales enablement',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Sales enablement/ })
    expect(within(row).getByText('OneDrive')).toBeInTheDocument()
    expect(within(row).getByText('knowledgeSpace.onlineDrive')).toBeInTheDocument()
    expect(row.querySelector('.i-logos-microsoft-onedrive')).toBeInTheDocument()
  })

  it('does not report ordinary source updates as successful syncs', () => {
    const syncPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    sourcesQuery.data = {
      pages: [{ items: [source({ metadata: { preview: false }, syncPolicy })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = screen.getByRole('row', { name: /Product documentation/ })
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('keeps read-only source viewing while hiding mutation and add-source actions', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourcesQuery.data = { pages: [{ items: [source({ status: 'error' })] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('link', { name: 'knowledgeSpace.addSource' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(screen.getByRole('menuitem', { name: 'knowledgeSpace.openSource' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.removeSource' }),
    ).not.toBeInTheDocument()
  })
})
