import type { Source, SourceSyncPolicy, SourceWorkflowRun } from '../source-models'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import datasetTranslations from '@/i18n/en-US/dataset.json'
import { render } from '@/test/console/render'
import { SourcesPage } from '../sources-page'

vi.mock('../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

const toastInfoMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const permissionState = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.acl.edit', 'dataset.external.connect'],
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

const syncPolicyApiResponse = vi.hoisted(() => (policy: SourceSyncPolicy) => ({
  created_at: policy.createdAt,
  custom_interval_seconds: policy.customIntervalSeconds ?? null,
  enabled: policy.enabled,
  expected_source_version: policy.expectedSourceVersion,
  id: policy.id,
  knowledge_space_id: policy.knowledgeSpaceId,
  mode: policy.mode,
  next_run_at: policy.nextRunAt ?? null,
  revision: policy.revision,
  source_id: policy.sourceId,
  updated_at: policy.updatedAt,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: toastErrorMock, info: toastInfoMock },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => permissionState)
})

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

const infiniteOptionsMock = vi.hoisted(() => vi.fn((_options: SourcesInfiniteOptions) => ({})))
const clientMock = vi.hoisted(() => ({
  deleteSource: vi.fn(),
  patchSource: vi.fn(),
  putSyncPolicy: vi.fn(),
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
    useInfiniteQuery: () => ({
      ...sourcesQuery,
      data: sourcesQuery.data
        ? {
            pages: sourcesQuery.data.pages.map((page) => ({
              data: page.items.map(sourceApiResponse),
              next_cursor: page.nextCursor ?? null,
            })),
          }
        : undefined,
    }),
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
      spaces: {
        byControlSpaceId: {
          sources: {
            bySourceId: {
              delete: clientMock.deleteSource,
              patch: async (input: unknown) =>
                sourceApiResponse(await clientMock.patchSource(input)),
              sync: { post: clientMock.syncSource },
              syncPolicy: {
                put: async (input: unknown) =>
                  syncPolicyApiResponse(await clientMock.putSyncPolicy(input)),
              },
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
    navigationMock.awaitInitialSource = null
    clientMock.deleteSource.mockResolvedValue({ status: 'accepted' })
    clientMock.patchSource.mockResolvedValue(source({}))
    clientMock.retrySourceWorkflow.mockResolvedValue(workflow())
    invalidateQueriesMock.mockResolvedValue(undefined)
    clientMock.syncSource.mockResolvedValue(workflow())
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
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
      query: { limit: 50 },
    })
    expect(options.input('next')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'next', limit: 50 },
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
    expect(screen.getByText('dataset.newKnowledge.awaitingInitialSource')).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
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
    expect(screen.getByText('dataset.newKnowledge.awaitingInitialSource')).toBeInTheDocument()
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

      act(() => screen.getByRole('button', { name: 'dataset.newKnowledge.refreshSources' }).click())
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
        screen.queryByRole('button', { name: 'dataset.newKnowledge.refreshSources' }),
      ).not.toBeInTheDocument()
      expect(currentRefetchInterval(...sourcesQuery.data.pages[0]!.items)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the designed empty state and exposes source-type shortcuts', () => {
    sourcesQuery.data = { pages: [{ items: [] }] }

    const { container } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.sourcesEmptyTitle')).toBeInTheDocument()
    expect(datasetTranslations['newKnowledge.sourcesEmptyDescription']).toBe(
      'Connect a website, workspace, or drive — Dify keeps it synced and fresh, so retrieval never breaks.',
    )
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.sources' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.addSource' })).toHaveAttribute(
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
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.moreProviders' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/sources/new')
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

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.sourceStatus.active')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.syncing')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.disabled')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.error')).toBeInTheDocument()

    const sourceFilter = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.sourceFilterLabel',
    })
    await user.click(sourceFilter)
    await user.click(
      screen.getByRole('option', { name: 'dataset.newKnowledge.sourceStatus.error' }),
    )
    expect(screen.getByText('Support site')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.click(sourceFilter)
    await user.click(
      screen.getByRole('option', { name: 'dataset.newKnowledge.sourceStatus.syncing' }),
    )
    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.click(sourceFilter)
    await user.click(screen.getByRole('option', { name: 'dataset.newKnowledge.allSources' }))
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'api',
    )
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

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.sourceColumn' }))
    const rowsAscending = screen.getAllByRole('row').slice(1)
    expect(within(rowsAscending[0]!).getByText('Alpha docs')).toBeInTheDocument()
    expect(within(rowsAscending[1]!).getByText('Zulu docs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.sourceColumn' }))
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
      'Initial documents: dataset.newKnowledge.sourceStatus.initializing',
    )
    const failedRow = screen.getByRole('row', { name: /Initial website/ })
    expect(
      within(failedRow).getByText('dataset.newKnowledge.sourceStatus.error'),
    ).toBeInTheDocument()

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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Initial documents"}',
      }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.openSource' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.edit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
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
        'dataset.newKnowledge.sourceStatus.syncing',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Failed Initial Source"}',
      }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
  })

  it('retries a failed async import workflow instead of starting a generic sync', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              name: 'Failed connected source',
              status: 'error',
              syncWorkflow: sourceWorkflow('failed'),
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Failed connected source"}',
      }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.retry' }))

    await waitFor(() => expect(clientMock.retrySourceWorkflow).toHaveBeenCalledOnce())
    expect(clientMock.retrySourceWorkflow).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'workflow-1' },
    })
    expect(clientMock.syncSource).not.toHaveBeenCalled()
    expect(within(sourceRow).getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.sourceStatus.syncing',
    )
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
      expect(screen.getByRole('status')).toHaveTextContent(
        'dataset.newKnowledge.sourceStatus.syncing',
      )
    })

    sourcesQuery.data = { pages: [{ items: [staleFailedSource] }] }
    view.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.sourceStatus.syncing',
    )
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
    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    const openSource = screen.getByRole('menuitem', {
      name: 'dataset.newKnowledge.openSource',
    })
    expect(openSource).toHaveAttribute('href', 'https://docs.example.com')
    expect(openSource).toHaveAttribute('target', '_blank')
    expect(openSource).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens an Amazon S3 source in the AWS console for read-only users', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.openSource' }),
    ).toHaveAttribute(
      'href',
      'https://s3.console.aws.amazon.com/s3/buckets/private-bucket?prefix=Product+documentation%2F%E6%96%87%E6%A1%A3',
    )
  })

  it('uses dataset.external.connect for every source mutation action', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.external.connect']
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.operation.edit' })).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
    ).toBeInTheDocument()
  })

  it('hides source mutations without dataset.external.connect', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.create_and_management']
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.openSource' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.edit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
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
    sourcesQuery.data = { pages: [{ items: [source({ syncPolicy: manualPolicy })] }] }
    clientMock.patchSource.mockResolvedValue(
      source({ name: 'Renamed documentation', syncPolicy: manualPolicy, version: 4 }),
    )
    clientMock.putSyncPolicy.mockResolvedValue(dailyPolicy)

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.newKnowledge.sourceName',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed documentation')
    await user.click(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }))
    await user.click(screen.getByRole('option', { name: 'dataset.newKnowledge.syncPolicyDaily' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: { expectedVersion: 3, name: 'Renamed documentation' },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    await waitFor(() =>
      expect(clientMock.putSyncPolicy).toHaveBeenCalledWith({
        body: {
          enabled: true,
          expectedRevision: 1,
          expectedSourceVersion: 4,
          mode: 'interval',
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(screen.getByRole('row', { name: /Renamed documentation/ })).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Renamed documentation/ })).getByText(
        'dataset.newKnowledge.syncPolicyDaily',
      ),
    ).toBeInTheDocument()
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    await waitFor(() =>
      expect(clientMock.syncSource).toHaveBeenCalledWith({
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceSyncProgress:{"completed":0,"total":1}',
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
          'dataset.newKnowledge.sourceStatus.active',
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
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()

    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    restored.rerender(<SourcesPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.sourceStatus.active',
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
    expect(within(row).getByText('dataset.newKnowledge.sourceStatus.disabled')).toBeInTheDocument()
    expect(
      within(row).queryByText('dataset.newKnowledge.sourceStatus.syncing'),
    ).not.toBeInTheDocument()

    await user.click(
      within(row).getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    expect(within(row).getByText('dataset.newKnowledge.sourceStatus.disabled')).toBeInTheDocument()
    expect(
      within(row).queryByText('dataset.newKnowledge.sourceStatus.syncing'),
    ).not.toBeInTheDocument()

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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))

    await waitFor(() =>
      expect(
        within(row).getByText('dataset.newKnowledge.sourceStatus.syncing'),
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

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'PROVIDER_FAILED',
        ),
      ).toBeInTheDocument(),
    )
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
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
        'dataset.newKnowledge.sourceStatus.active',
      ),
    ).toBeInTheDocument()
  })

  it('tracks a newer server workflow after a local sync completes', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    const rendered = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    sourcesQuery.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    rendered.rerender(<SourcesPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.sourceStatus.active',
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
          'dataset.newKnowledge.sourceStatus.syncing',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.sourceStatus.syncing',
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
          'dataset.newKnowledge.sourceStatus.active',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

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
          'dataset.newKnowledge.sourceStatus.syncing',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.sourceStatus.syncing',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    expect(clientMock.syncSource).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.overview.attention.modelReadiness.title',
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
    ).getByRole('button', { name: /dataset.newKnowledge.sourceActions/ })
    const disabledSourceActions = within(
      screen.getByRole('row', { name: /Disabled source/ }),
    ).getByRole('button', { name: /dataset.newKnowledge.sourceActions/ })
    await user.click(activeSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }))
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }))

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.disabled',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.syncPolicyDaily',
      ),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.syncPolicyDaily',
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
    expect(within(row).getByText('dataset.newKnowledge.syncPolicyManual')).toBeInTheDocument()
    expect(within(row).queryByText('dataset.newKnowledge.syncPolicyDaily')).not.toBeInTheDocument()
    expect(within(row).queryByText('—')).not.toBeInTheDocument()
  })

  it('requires confirmation before removing a source', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }))

    expect(clientMock.deleteSource).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }))
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
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('dataset.newKnowledge.sourcesErrorDescription'),
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }),
    ).toBeInTheDocument()
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
        'dataset.newKnowledge.sourceStatus.syncing',
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
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('continues from an empty cursor page when a later page exists', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('continues through cursor pages before declaring a filtered search empty', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.queryByText('dataset.newKnowledge.noMatchingSources')).not.toBeInTheDocument()
  })

  it('caps automatic filtered pagination and offers explicit continuation', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: Array.from({ length: 4 }, (_, index) => ({
        items: [source({ id: `source-${index}`, name: `Source ${index}` })],
        nextCursor: `cursor-${index + 1}`,
      })),
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }),
    ).toBeInTheDocument()
  })

  it('stops automatic filtered pagination after a cursor error', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true
    sourcesQuery.isFetchNextPageError = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.noMatchingSources')).not.toBeInTheDocument()
  })

  it('shows provider and source type as separate row details', () => {
    sourcesQuery.data = {
      pages: [{ items: [source({ metadata: { providerName: 'Firecrawl' } })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Firecrawl')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceType.web')).toBeInTheDocument()
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
    expect(within(row).getByText('dataset.newKnowledge.syncPolicyDaily')).toBeInTheDocument()
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
    expect(within(row).getByText('dataset.newKnowledge.onlineDocuments')).toBeInTheDocument()
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
    expect(within(row).getByText('dataset.newKnowledge.onlineDrive')).toBeInTheDocument()
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
    expect(within(row).getByText('dataset.newKnowledge.onlineDrive')).toBeInTheDocument()
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
    sourcesQuery.data = { pages: [{ items: [source({ status: 'error' })] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.addSource' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.openSource' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
    ).not.toBeInTheDocument()
  })
})
