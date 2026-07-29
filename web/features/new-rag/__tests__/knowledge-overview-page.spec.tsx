import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { KnowledgeOverviewPage } from '../overview/knowledge-overview-page'

const queryOptionsMocks = vi.hoisted(() => ({
  health: vi.fn(),
  inventory: vi.fn(),
  outcomes: vi.fn(),
  stats: vi.fn(),
}))

const queryData = vi.hoisted(() => ({
  health: {
    components: {
      index: { codes: [] as string[], state: 'healthy' },
      ingestion: { codes: [] as string[], state: 'healthy' },
      profile_publication: { codes: [] as string[], state: 'healthy' },
      query_availability: { codes: [] as string[], state: 'healthy' },
      source_freshness: { codes: [] as string[], state: 'healthy' },
      worker_readiness: { codes: [] as string[], state: 'healthy' },
    },
    generated_at: '2026-07-29T09:00:00Z',
    knowledge_space_id: 'knowledge-1',
    state: 'healthy',
  },
  inventory: {
    generated_at: '2026-07-29T09:00:00Z',
    graph_entities: { added_last_7d: 1, total: 12 },
    graph_relations: { added_last_7d: 2, total: 18 },
    index_coverage: { indexed: 4, percentage: 80, total: 5 },
    knowledge_space_id: 'knowledge-1',
    source_categories: { crawl: 1, online_documents: 1, online_drives: 0, uploads: 1 },
  },
  outcomes: {
    buckets: [],
    current: {
      answer_rate: 0.84,
      answered: 8,
      low_confidence: 1,
      no_evidence: 1,
      query_count: 10,
    },
    generated_at: '2026-07-29T09:00:00Z',
    knowledge_space_id: 'knowledge-1',
    previous: {
      answer_rate: 0.8,
      answered: 4,
      low_confidence: 1,
      no_evidence: 0,
      query_count: 5,
    },
    previous_since: '2026-07-27T09:00:00Z',
    since: '2026-07-28T09:00:00Z',
    window: '24h',
  },
  stats: {
    answer_rate: { change_percentage_points: 4, previous_value: 0.8, value: 0.84 },
    documents: 5,
    fresh_source_count: 3,
    freshness_seconds: 18000,
    generated_at: '2026-07-29T09:00:00Z',
    knowledge_space_id: 'knowledge-1',
    linked_apps: 2,
    queries: { change_rate: 1, previous_value: 5, value: 10 },
    source_count: 3,
    stale_source_count: 0,
    window: '24h',
  },
  tasks: [
    {
      can_cancel: false,
      can_retry: false,
      completed_at: '2026-07-29T08:05:00Z',
      created_at: '2026-07-29T08:00:00Z',
      id: 'task-1',
      knowledge_space_id: 'knowledge-1',
      operation: 'source_sync',
      progress_completed: 1,
      progress_failed: 0,
      progress_percent: 100,
      progress_total: 1,
      state: 'completed',
      task_kind: 'source',
      updated_at: '2026-07-29T08:05:00Z',
    },
  ],
}))

const tasksQueryState = vi.hoisted(() => ({
  isError: false,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
}))

const overviewQueryState = vi.hoisted(() => ({
  health: { isError: false, isFetching: false, isPending: false },
  inventory: { isError: false, isFetching: false, isPending: false },
  outcomes: { isError: false, isFetching: false, isPending: false },
  stats: { isError: false, isFetching: false, isPending: false },
}))

const permissionState = vi.hoisted(() => ({
  datasetKeys: ['dataset.acl.edit'],
  datasetKeysAtom: Symbol('datasetDefaultPermissionKeysAtom'),
  workspaceKeys: ['dataset.external.connect'],
  workspaceKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

const systemFeaturesState = vi.hoisted(() => ({
  uploadAvailable: true,
  uploadAvailableAtom: Symbol('knowledgeFsUploadEnabledAtom'),
}))

vi.mock('echarts-for-react', () => ({
  default: () => <div aria-label="query outcomes chart" />,
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionState.datasetKeysAtom,
  workspacePermissionKeysAtom: permissionState.workspaceKeysAtom,
}))

vi.mock('@/context/system-features-state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesState.uploadAvailableAtom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) => {
      if (atom === permissionState.datasetKeysAtom) return permissionState.datasetKeys
      if (atom === permissionState.workspaceKeysAtom) return permissionState.workspaceKeys
      if (atom === systemFeaturesState.uploadAvailableAtom)
        return systemFeaturesState.uploadAvailable
      return original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0])
    },
  }
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({ data: { accounts: [] } }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => ({
      data: { pages: [{ data: queryData.tasks, next_cursor: null }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: tasksQueryState.isError,
      isFetchingNextPage: false,
      isPending: tasksQueryState.isPending,
      isRefetching: tasksQueryState.isRefetching,
      refetch: tasksQueryState.refetch,
    }),
    useQuery: (options: { queryKey: string[] }) => {
      const name = options.queryKey[0] as keyof typeof overviewQueryState
      const state = overviewQueryState[name]
      return {
        data: state.isError ? undefined : queryData[name],
        ...state,
        refetch: vi.fn(),
      }
    },
  }
})

vi.mock('@/service/client', () => {
  const query = (name: keyof typeof queryOptionsMocks) => ({
    queryOptions: (options: unknown) => {
      queryOptionsMocks[name](options)
      return { queryKey: [name] }
    },
  })

  return {
    consoleQuery: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            backgroundTasks: {
              get: {
                infiniteOptions: () => ({}),
              },
            },
            overview: {
              health: { get: query('health') },
              inventory: { get: query('inventory') },
              queryOutcomes: { get: query('outcomes') },
              stats: { get: query('stats') },
            },
          },
        },
      },
    },
  }
})

describe('KnowledgeOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksQueryState.isError = false
    tasksQueryState.isPending = false
    tasksQueryState.isRefetching = false
    for (const state of Object.values(overviewQueryState)) {
      state.isError = false
      state.isFetching = false
      state.isPending = false
    }
    permissionState.datasetKeys = ['dataset.acl.edit']
    permissionState.workspaceKeys = ['dataset.external.connect']
    systemFeaturesState.uploadAvailable = true
    for (const component of Object.values(queryData.health.components)) {
      component.codes = []
      component.state = 'healthy'
    }
    queryData.stats.source_count = 3
    queryData.stats.documents = 5
    queryData.inventory.index_coverage.indexed = 4
    queryData.tasks[0]!.operation = 'source_sync'
    queryData.tasks[0]!.progress_completed = 1
    queryData.tasks[0]!.progress_percent = 100
    queryData.tasks[0]!.progress_total = 1
    queryData.tasks[0]!.state = 'completed'
    queryData.tasks[0]!.updated_at = '2026-07-29T08:05:00Z'
    queryData.stats.generated_at = '2026-07-29T09:00:00Z'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refreshes the time-window queries when a user switches the overview range', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const sevenDayTab = screen.getByRole('button', {
      name: 'dataset.newKnowledge.overview.sevenDays',
    })
    await user.click(sevenDayTab)

    expect(sevenDayTab).toHaveAttribute('aria-pressed', 'true')
    expect(queryOptionsMocks.stats).toHaveBeenLastCalledWith({
      input: {
        params: { control_space_id: 'space-1' },
        query: { window: '7d' },
      },
      refetchInterval: expect.any(Function),
    })
    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('window')).toBe('7d')
      expect(urlUpdate?.options.history).toBe('push')
    })
  })

  it('restores the selected overview range from the URL', () => {
    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />, {
      searchParams: '?window=30d',
    })

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.overview.thirtyDays' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(queryOptionsMocks.stats).toHaveBeenLastCalledWith({
      input: {
        params: { control_space_id: 'space-1' },
        query: { window: '30d' },
      },
      refetchInterval: expect.any(Function),
    })
  })

  it('renders ratio fields from the API contract as percentages', () => {
    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('+100%')).toBeInTheDocument()
    expect(screen.getByText('+4pp')).toBeInTheDocument()
  })

  it('shows an activity error with a retry action instead of an empty state', async () => {
    const user = userEvent.setup()
    tasksQueryState.isError = true

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.tasksErrorDescription')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(tasksQueryState.refetch).toHaveBeenCalledOnce()
    const activitySection = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.overview.recentActivity' })
      .closest('section')
    expect(activitySection).not.toBeNull()
    expect(
      within(activitySection!).queryByText('dataset.newKnowledge.overview.noActivity'),
    ).not.toBeInTheDocument()
  })

  it('localizes health issues and clamps the page when polling removes issues', async () => {
    const user = userEvent.setup()
    for (const component of Object.values(queryData.health.components)) component.state = 'degraded'
    queryData.health.components.ingestion.codes = ['INGESTION_FAILURE_PRESENT']
    const rendered = renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('INGESTION_FAILURE_PRESENT')).not.toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.overview.operation.document_processing'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    for (const component of Object.values(queryData.health.components)) component.state = 'healthy'
    queryData.health.components.ingestion.state = 'degraded'
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  })

  it('opens the complete activity view from recent activity', async () => {
    const user = userEvent.setup()
    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.overview.allActivity' }),
    )

    expect(
      await screen.findByRole('dialog', {
        name: 'dataset.newKnowledge.overview.allActivity',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.overview.timeRange' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'dataset.newKnowledge.overview.operator' }),
    ).not.toBeInTheDocument()
  })

  it('refreshes overview snapshots until they catch up with a completed background task', () => {
    queryData.tasks[0]!.state = 'running'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:00:00Z'
    const rendered = renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    const statsRefreshInterval = () => {
      const options = queryOptionsMocks.stats.mock.lastCall?.[0] as {
        refetchInterval: (query: { state: { data: typeof queryData.stats } }) => false | number
      }
      return options.refetchInterval
    }

    expect(statsRefreshInterval()({ state: { data: queryData.stats } })).toBe(2000)

    queryData.tasks[0]!.state = 'completed'
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    expect(statsRefreshInterval()({ state: { data: queryData.stats } })).toBe(2000)

    queryData.stats.generated_at = '2026-07-29T10:01:00Z'
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    expect(statsRefreshInterval()({ state: { data: queryData.stats } })).toBe(false)
  })

  it('offers source connection and direct upload when the knowledge base is empty', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.overview.noSources' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.overview.connectSource' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/sources/new')
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.overview.uploadFiles' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/documents?upload=1')
    expect(screen.getAllByText('—')).toHaveLength(5)
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.overview.needsAttention' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.overview.noQueryData')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.documentsEmptyTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.overview.allActivity' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('hides write-only onboarding actions for a read-only user', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    permissionState.datasetKeys = ['dataset.acl.readonly']
    permissionState.workspaceKeys = ['dataset.acl.readonly']

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.overview.connectSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.overview.uploadFiles' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.overview.readOnlyDescription'),
    ).toBeInTheDocument()
  })

  it('gates source connection and upload independently', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    permissionState.datasetKeys = ['dataset.acl.readonly']
    permissionState.workspaceKeys = ['dataset.external.connect']
    const rendered = renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.overview.connectSource' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.overview.uploadFiles' }),
    ).not.toBeInTheDocument()

    permissionState.datasetKeys = ['dataset.acl.edit']
    permissionState.workspaceKeys = []
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.overview.connectSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.overview.uploadFiles' }),
    ).toBeInTheDocument()
  })

  it('shows explicit section errors instead of healthy or zero-value fallbacks', () => {
    overviewQueryState.health.isError = true
    overviewQueryState.inventory.isError = true

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const healthSection = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.overview.needsAttention' })
      .closest('section')
    const inventorySection = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.overview.inventory' })
      .closest('section')
    expect(healthSection).not.toBeNull()
    expect(inventorySection).not.toBeNull()
    expect(
      within(healthSection!).getByText('dataset.newKnowledge.detailErrorDescription'),
    ).toBeInTheDocument()
    expect(
      within(healthSection!).queryByText('dataset.newKnowledge.overview.noIssues'),
    ).not.toBeInTheDocument()
    expect(
      within(inventorySection!).getByText('dataset.newKnowledge.detailErrorDescription'),
    ).toBeInTheDocument()
    expect(
      within(inventorySection!).queryByText(
        'dataset.newKnowledge.overview.indexedDocuments:{"indexed":0,"total":0}',
      ),
    ).not.toBeInTheDocument()
  })

  it('shows overview data when uploaded documents exist without a connected source', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.overview.connectSource' }),
    ).not.toBeInTheDocument()
  })

  it('shows first-indexing progress while the initial document task is running', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.progress_completed = 1
    queryData.tasks[0]!.progress_percent = 50
    queryData.tasks[0]!.progress_total = 2
    queryData.tasks[0]!.state = 'running'

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.overview.indexing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.overview.indexedDocuments:{"indexed":1,"total":2}'),
    ).toBeInTheDocument()
  })

  it('shows the actual elapsed minutes for recent activity', () => {
    const now = Date.parse('2026-07-29T09:04:30Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    queryData.tasks[0]!.updated_at = '2026-07-29T08:05:00Z'

    renderWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('59 minutes ago')).toBeInTheDocument()
  })
})
