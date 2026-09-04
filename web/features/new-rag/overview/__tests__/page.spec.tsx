import type { Getter } from 'jotai'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { formatMetricChange } from '../overview-format'
import { MetricCard } from '../overview-metrics'
import { KnowledgeOverviewPage } from '../page'

vi.mock('../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

const queryOptionsMocks = vi.hoisted(() => ({
  activity: vi.fn(),
  attention: vi.fn(),
  inventory: vi.fn(),
  outcomes: vi.fn(),
  source: vi.fn(),
  stats: vi.fn(),
}))

const infiniteOptionsMocks = vi.hoisted(() => ({
  activity: vi.fn(),
  tasks: vi.fn(),
}))

const chartOptions = vi.hoisted(() => ({ current: undefined as unknown }))

const queryData = vi.hoisted(() => ({
  activity: {
    data: [
      {
        action: 'source.synced',
        actor: { id: 'dify-account:member-1', type: 'member' },
        details: { count: 1 } as Record<string, boolean | number | string>,
        id: 'activity-1',
        occurred_at: '2026-07-29T08:05:00Z',
        resource: { id: 'source-1', type: 'source' },
        result: 'success',
      },
    ],
    next_cursor: null,
  },
  attention: {
    data: [] as Array<{
      action: {
        kind: 'open-resource' | 'review-models' | 'review-permissions'
        resource_id?: string
        resource_type: 'document' | 'failed-query' | 'knowledge-space' | 'source'
      }
      evidence: Array<{ code: string; observed_at: string }>
      issue_key: string
      knowledge_space_id: string
      resource: {
        id: string
        type: 'document' | 'failed-query' | 'knowledge-space' | 'source'
      }
      revision: number
      rule_id:
        | 'failed-document'
        | 'low-quality-query'
        | 'model-readiness'
        | 'permission-readiness'
        | 'stale-source'
      severity: 'critical' | 'info' | 'warning'
      status: 'active' | 'dismissed' | 'resolved'
      title: string
      updated_at: string
    }>,
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
    buckets: [] as Array<{
      answered: number
      low_confidence: number
      no_evidence: number
      start_at: string
    }>,
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
  source: {
    name: 'Notion — Support SOP',
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
      source_id: undefined as null | string | undefined,
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

const retryTaskMutationState = vi.hoisted(() => ({
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
}))

const overviewQueryState = vi.hoisted(() => ({
  activity: { isError: false, isFetching: false, isPending: false },
  attention: { isError: false, isFetching: false, isPending: false },
  inventory: { isError: false, isFetching: false, isPending: false },
  outcomes: { isError: false, isFetching: false, isPending: false },
  source: { isError: false, isFetching: false, isPending: false },
  stats: { isError: false, isFetching: false, isPending: false },
}))

const permissionState = vi.hoisted(() => ({
  datasetKeys: ['dataset.acl.edit'],
  datasetKeysAtom: Symbol('datasetDefaultPermissionKeysAtom'),
  spaceKeys: ['knowledge_space_document_write'],
  workspaceKeys: ['dataset.external.connect'],
  workspaceKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

const systemFeaturesState = vi.hoisted(() => ({
  uploadAvailable: true,
  uploadAvailableAtom: Symbol('knowledgeFsUploadEnabledAtom'),
}))

const jotaiQueryMocks = vi.hoisted(() => ({
  bump: undefined as undefined | (() => void),
  refetchActivity: vi.fn(),
}))

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: unknown }) => {
    chartOptions.current = option
    return <div aria-label="query outcomes chart" />
  },
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionState.datasetKeysAtom,
  workspacePermissionKeysAtom: permissionState.workspaceKeysAtom,
}))

vi.mock('@/features/system-features/state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesState.uploadAvailableAtom,
}))

vi.mock('../../space/context', () => ({
  useKnowledgeSpacePermission: (permission: string) =>
    permissionState.spaceKeys.includes(permission),
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

vi.mock('jotai-tanstack-query', async () => {
  const { atom, getDefaultStore } = await import('jotai/vanilla')
  const revisionAtom = atom(0)
  jotaiQueryMocks.bump = () =>
    getDefaultStore().set(revisionAtom, (revision: number) => revision + 1)

  return {
    atomWithInfiniteQuery: (getOptions: (get: Getter) => { queryKey: string[] }) =>
      atom((get) => {
        get(revisionAtom)
        getOptions(get)
        return {
          data: { pages: [{ data: queryData.tasks, next_cursor: null }] },
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isError: tasksQueryState.isError,
          isFetchingNextPage: false,
          isPending: tasksQueryState.isPending,
          isRefetching: tasksQueryState.isRefetching,
          refetch: tasksQueryState.refetch,
        }
      }),
    atomWithQuery: (getOptions: (get: Getter) => { input?: unknown; queryKey: string[] }) =>
      atom((get) => {
        get(revisionAtom)
        const options = getOptions(get)
        const name = options.queryKey[0] as keyof typeof overviewQueryState
        const state = overviewQueryState[name]
        const skipped = typeof options.input === 'symbol'
        return {
          data: state.isError || skipped ? undefined : queryData[name],
          ...state,
          isRefetching: state.isFetching,
          refetch: name === 'activity' ? jotaiQueryMocks.refetchActivity : vi.fn(),
        }
      }),
  }
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        {
          avatar_url: 'https://example.com/avatar.png',
          email: 'ada@example.com',
          id: 'member-1',
          name: 'Ada',
        },
      ],
    },
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: { queryKey: string[] }) => ({
      data: {
        pages: [
          options.queryKey[0] === 'activityInfinite'
            ? queryData.activity
            : { data: queryData.tasks, next_cursor: null },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: options.queryKey[0] === 'activityInfinite' ? false : tasksQueryState.isError,
      isFetchingNextPage: false,
      isPending: tasksQueryState.isPending,
      isRefetching: tasksQueryState.isRefetching,
      refetch: options.queryKey[0] === 'activityInfinite' ? vi.fn() : tasksQueryState.refetch,
    }),
    useQuery: (options: { input?: unknown; queryKey: string[] }) => {
      const name = options.queryKey[0] as keyof typeof overviewQueryState
      const state = overviewQueryState[name]
      return {
        data: state.isError || options.input === original.skipToken ? undefined : queryData[name],
        ...state,
        refetch: vi.fn(),
      }
    },
    useMutation: () => retryTaskMutationState,
  }
})

vi.mock('@/service/client', () => {
  const query = (name: keyof typeof queryOptionsMocks) => ({
    queryOptions: (options: unknown) => {
      queryOptionsMocks[name](options)
      return { input: (options as { input?: unknown }).input, queryKey: [name] }
    },
  })

  return {
    consoleQuery: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            backgroundTasks: {
              byTaskKind: {
                byTaskId: {
                  retry: {
                    post: {
                      mutationOptions: () => ({}),
                    },
                  },
                },
              },
              get: {
                infiniteOptions: (options: unknown) => {
                  infiniteOptionsMocks.tasks(options)
                  return { ...(options as object), queryKey: ['tasksInfinite'] }
                },
              },
            },
            overview: {
              activity: {
                get: {
                  ...query('activity'),
                  infiniteOptions: (options: unknown) => {
                    infiniteOptionsMocks.activity(options)
                    return { ...(options as object), queryKey: ['activityInfinite'] }
                  },
                },
              },
              attention: { get: query('attention') },
              inventory: { get: query('inventory') },
              queryOutcomes: { get: query('outcomes') },
              stats: { get: query('stats') },
            },
            sources: {
              bySourceId: {
                get: query('source'),
              },
            },
          },
        },
      },
    },
  }
})

function renderOverviewWithNuqs(
  ui: Parameters<typeof renderWithNuqs>[0],
  options?: Parameters<typeof renderWithNuqs>[1],
) {
  jotaiQueryMocks.bump?.()
  const rendered = renderWithNuqs(ui, options)
  return {
    ...rendered,
    rerender: (nextUi: Parameters<typeof rendered.rerender>[0]) => {
      act(() => jotaiQueryMocks.bump?.())
      rendered.rerender(nextUi)
    },
  }
}

describe('KnowledgeOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksQueryState.isError = false
    tasksQueryState.isPending = false
    tasksQueryState.isRefetching = false
    retryTaskMutationState.isError = false
    retryTaskMutationState.isPending = false
    retryTaskMutationState.mutateAsync.mockResolvedValue(undefined)
    for (const state of Object.values(overviewQueryState)) {
      state.isError = false
      state.isFetching = false
      state.isPending = false
    }
    permissionState.datasetKeys = ['dataset.acl.edit']
    permissionState.spaceKeys = ['knowledge_space_document_write']
    permissionState.workspaceKeys = ['dataset.external.connect']
    systemFeaturesState.uploadAvailable = true
    queryData.attention.data = []
    queryData.activity.data.splice(1)
    queryData.activity.data[0]!.action = 'source.synced'
    queryData.activity.data[0]!.actor = { id: 'dify-account:member-1', type: 'member' }
    queryData.activity.data[0]!.details = { count: 1 }
    queryData.activity.data[0]!.occurred_at = '2026-07-29T08:05:00Z'
    queryData.activity.data[0]!.result = 'success'
    queryData.stats.source_count = 3
    queryData.stats.documents = 5
    queryData.outcomes.buckets = []
    queryData.inventory.source_categories = {
      crawl: 1,
      online_documents: 1,
      online_drives: 0,
      uploads: 1,
    }
    queryData.inventory.index_coverage.indexed = 4
    queryData.tasks[0]!.operation = 'source_sync'
    queryData.tasks[0]!.can_retry = false
    queryData.tasks[0]!.progress_completed = 1
    queryData.tasks[0]!.progress_percent = 100
    queryData.tasks[0]!.progress_total = 1
    queryData.tasks[0]!.source_id = undefined
    queryData.tasks[0]!.state = 'completed'
    queryData.tasks[0]!.updated_at = '2026-07-29T08:05:00Z'
    queryData.stats.generated_at = '2026-07-29T09:00:00Z'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refreshes the metrics query when a user switches the overview range', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderOverviewWithNuqs(
      <KnowledgeOverviewPage knowledgeSpaceId="space-1" />,
    )

    const sevenDayRadio = screen.getByRole('radio', {
      name: 'knowledgeSpace.overview.sevenDays',
    })
    await user.click(sevenDayRadio)

    expect(sevenDayRadio).toHaveAttribute('aria-checked', 'true')
    expect(queryOptionsMocks.stats).toHaveBeenLastCalledWith({
      input: {
        params: { control_space_id: 'space-1' },
        query: { window: '7d' },
      },
      refetchInterval: expect.any(Function),
    })
    expect(queryOptionsMocks.outcomes).toHaveBeenLastCalledWith({
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
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />, {
      searchParams: '?window=30d',
    })

    expect(
      screen.getByRole('radio', { name: 'knowledgeSpace.overview.thirtyDays' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(queryOptionsMocks.stats).toHaveBeenLastCalledWith({
      input: {
        params: { control_space_id: 'space-1' },
        query: { window: '30d' },
      },
      refetchInterval: expect.any(Function),
    })
    expect(queryOptionsMocks.outcomes).toHaveBeenLastCalledWith({
      input: {
        params: { control_space_id: 'space-1' },
        query: { window: '30d' },
      },
      refetchInterval: expect.any(Function),
    })
  })

  it('renders ratio fields from the API contract as percentages', () => {
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('+100%')).toBeInTheDocument()
    expect(screen.getByText('+4 pp')).toBeInTheDocument()
  })

  it('keeps the increase direction when a localized label starts with a bidi mark', () => {
    const change = formatMetricChange(25, 'ar-TN')

    render(<MetricCard change={change} empty={false} loading={false} title="Queries" value="100" />)

    const changeIndicator = screen.getByText(change.label)
    expect(change.label.startsWith('+')).toBe(false)
    expect(changeIndicator).toHaveClass('text-text-success')
    expect(changeIndicator.querySelector('[aria-hidden]')).toHaveClass('i-ri-arrow-up-s-fill')
  })

  it('omits zero-value source segments from the inventory bar', () => {
    queryData.inventory.source_categories = {
      crawl: 0,
      online_documents: 0,
      online_drives: 0,
      uploads: 1,
    }

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const inventoryBar = screen.getByLabelText('knowledgeSpace.overview.sources')
    expect(inventoryBar.children).toHaveLength(1)
    expect(inventoryBar.firstElementChild).toHaveStyle({ width: '100%' })
  })

  it('keeps existing overview data visible during a background refresh', () => {
    overviewQueryState.stats.isFetching = true
    overviewQueryState.outcomes.isFetching = true
    queryData.outcomes.buckets = [
      {
        answered: 8,
        low_confidence: 1,
        no_evidence: 1,
        start_at: '2026-07-29T09:00:00Z',
      },
    ]

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByLabelText('query outcomes chart')).toBeInTheDocument()
  })

  it('uses straight segments and a single-series tooltip for query outcomes', () => {
    queryData.outcomes.buckets = [
      {
        answered: 8,
        low_confidence: 1,
        no_evidence: 1,
        start_at: '2026-07-29T09:00:00Z',
      },
    ]

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const options = chartOptions.current as {
      series: Array<{ smooth: boolean }>
      tooltip: { trigger: string }
      yAxis: { max?: number; minInterval: number }
    }
    expect(options.series.every((series) => series.smooth === false)).toBe(true)
    expect(options.tooltip.trigger).toBe('item')
    expect(options.yAxis.minInterval).toBe(1)
    expect(options.yAxis.max).toBeUndefined()
  })

  it('shows the member who performed an activity instead of a system placeholder', () => {
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.system')).not.toBeInTheDocument()
  })

  it('keeps activities beyond the seventh row available in the recent activity list', () => {
    const activity = queryData.activity.data[0]!
    queryData.activity.data.push(
      ...Array.from({ length: 7 }, (_, index) => ({
        ...activity,
        id: `activity-${index + 2}`,
      })),
    )

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const recentActivity = screen.getByRole('table', {
      name: 'knowledgeSpace.overview.recentActivity',
    })
    const activityOptions = queryOptionsMocks.activity.mock.lastCall?.[0] as {
      input: { query: { limit: number } }
    }
    expect(activityOptions.input.query.limit).toBeGreaterThan(7)
    expect(within(recentActivity).getAllByRole('row')).toHaveLength(9)
  })

  it('reveals resolved modules while waiting to decide the page empty state', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    for (const state of Object.values(overviewQueryState)) state.isPending = true

    const { rerender } = renderOverviewWithNuqs(
      <KnowledgeOverviewPage knowledgeSpaceId="space-1" />,
    )

    expect(
      screen.getByRole('radiogroup', { name: 'knowledgeSpace.overview.timeRange' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'knowledgeSpace.overview.noSources' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.needsAttention' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()

    overviewQueryState.stats.isPending = false
    rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('radiogroup', { name: 'knowledgeSpace.overview.timeRange' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'knowledgeSpace.overview.noSources' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()

    for (const state of Object.values(overviewQueryState)) state.isPending = false
    rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.noSources' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'knowledgeSpace.overview.timeRange' }),
    ).not.toBeInTheDocument()
  })

  it('shows an activity error with a retry action instead of an empty state', async () => {
    const user = userEvent.setup()
    overviewQueryState.activity.isError = true

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSpace.tasksErrorDescription')).toBeInTheDocument()
    const activitySection = screen
      .getByRole('heading', { name: 'knowledgeSpace.overview.recentActivity' })
      .closest('section')
    expect(activitySection).not.toBeNull()
    await user.click(
      within(activitySection!).getByRole('button', { name: 'common.operation.retry' }),
    )
    expect(
      within(activitySection!).queryByText('knowledgeSpace.overview.noActivity'),
    ).not.toBeInTheDocument()
  })

  it('renders specific attention findings and clamps the page when polling removes issues', async () => {
    const user = userEvent.setup()
    queryData.attention.data = Array.from({ length: 6 }, (_, index) => ({
      action: {
        kind: 'open-resource' as const,
        resource_id: `source-${index}`,
        resource_type: 'source' as const,
      },
      evidence: [{ code: 'SOURCE_STALE', observed_at: '2026-07-29T08:00:00Z' }],
      issue_key: `issue-${index}`,
      knowledge_space_id: 'knowledge-1',
      resource: { id: `source-${index}`, type: 'source' as const },
      revision: 1,
      rule_id: 'stale-source' as const,
      severity: index === 0 ? ('critical' as const) : ('warning' as const),
      status: 'active' as const,
      title: `Source ${index} has not synced in 7 days`,
      updated_at: '2026-07-29T08:00:00Z',
    }))
    const rendered = renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('knowledgeSpace.overview.attention.staleSource.title')).toHaveLength(
      4,
    )
    expect(screen.queryByText('Source 0 has not synced in 7 days')).not.toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.overview.blocker')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    queryData.attention.data = queryData.attention.data.slice(0, 1)
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  })

  it('explains model blockers and ignores retired permission-readiness responses', () => {
    queryData.attention.data = [
      {
        action: { kind: 'review-models', resource_type: 'knowledge-space' },
        evidence: [
          { code: 'MODEL_PROFILE_NOT_READY', observed_at: '2026-07-29T08:00:00Z' },
          { code: 'MODEL_RETRIEVAL_PROFILE_MISSING', observed_at: '2026-07-29T08:00:00Z' },
          { code: 'MODEL_PUBLICATION_BINDING_MISSING', observed_at: '2026-07-29T08:00:00Z' },
        ],
        issue_key: 'model-readiness:knowledge-space:knowledge-1',
        knowledge_space_id: 'knowledge-1',
        resource: { id: 'knowledge-1', type: 'knowledge-space' },
        revision: 1,
        rule_id: 'model-readiness',
        severity: 'critical',
        status: 'active',
        title: 'Retrieval model profile is not published',
        updated_at: '2026-07-29T08:00:00Z',
      },
      {
        action: { kind: 'review-permissions', resource_type: 'knowledge-space' },
        evidence: [
          { code: 'PERMISSION_AGGREGATE_NOT_READY', observed_at: '2026-07-29T08:00:00Z' },
          { code: 'PERMISSION_POLICY_MISSING', observed_at: '2026-07-29T08:00:00Z' },
          { code: 'PERMISSION_OWNER_MISSING', observed_at: '2026-07-29T08:00:00Z' },
        ],
        issue_key: 'permission-readiness:knowledge-space:knowledge-1',
        knowledge_space_id: 'knowledge-1',
        resource: { id: 'knowledge-1', type: 'knowledge-space' },
        revision: 1,
        rule_id: 'permission-readiness',
        severity: 'critical',
        status: 'active',
        title: 'Knowledge-space permissions are not ready',
        updated_at: '2026-07-29T08:00:00Z',
      },
    ]

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByText('knowledgeSpace.overview.attention.modelReadiness.title'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'knowledgeSpace.overview.attention.modelReadiness.profilesMissing knowledgeSpace.overview.attention.modelReadiness.bindingMissing',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'knowledgeSpace.overview.attention.action.configureModels',
      }),
    ).toHaveAttribute('href', '/datasets/new/space-1/settings')
    expect(screen.queryByText('Retrieval model profile is not published')).not.toBeInTheDocument()
    expect(screen.queryByText('Knowledge-space permissions are not ready')).not.toBeInTheDocument()
  })

  it('opens the complete activity view from recent activity', async () => {
    const user = userEvent.setup()
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    const whenHeader = screen.getByRole('columnheader', {
      name: 'knowledgeSpace.overview.when',
    })

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.overview.allActivity' }))

    expect(
      await screen.findByRole('dialog', {
        name: 'knowledgeSpace.overview.allActivity',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'knowledgeSpace.overview.timeRange' }),
    ).toHaveTextContent('knowledgeSpace.overview.today')
    expect(
      screen.getByRole('combobox', { name: 'knowledgeSpace.overview.operator' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'knowledgeSpace.overview.timeRange' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.bg-transparent')).toBeInTheDocument()
    expect(whenHeader).not.toHaveClass('opacity-0')
  })

  it('enables the complete activity query only while its drawer is open', async () => {
    const user = userEvent.setup()
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(infiniteOptionsMocks.activity.mock.lastCall?.[0]).toMatchObject({ enabled: false })

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.overview.allActivity' }))

    expect(infiniteOptionsMocks.activity.mock.lastCall?.[0]).toMatchObject({ enabled: true })
  })

  it('restarts activity pagination when the date or operator filter changes', async () => {
    const user = userEvent.setup()
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.overview.allActivity' }))

    const operator = screen.getByRole('combobox', {
      name: 'knowledgeSpace.overview.operator',
    })
    await user.click(operator)
    await user.click(await screen.findByRole('option', { name: 'Ada' }))

    const memberOptions = infiniteOptionsMocks.activity.mock.lastCall?.[0] as {
      input: (cursor: string | null) => {
        query: Record<string, unknown>
      }
      queryKey: unknown[]
    }
    expect(memberOptions.queryKey).toEqual([
      'knowledge-fs-overview-activity',
      'space-1',
      expect.any(String),
      expect.any(String),
      'member:member-1',
    ])
    expect(memberOptions.input(null).query).toMatchObject({
      actor_id: 'dify-account:member-1',
      actor_type: 'member',
      limit: 20,
    })
    expect(memberOptions.input('older').query.cursor).toBe('older')

    const timeRange = screen.getByRole('combobox', {
      name: 'knowledgeSpace.overview.timeRange',
    })
    await user.click(timeRange)
    await user.click(await screen.findByRole('option', { name: 'knowledgeSpace.overview.today' }))

    const todayOptions = infiniteOptionsMocks.activity.mock.lastCall?.[0] as {
      input: (cursor: string | null) => {
        query: Record<string, unknown>
      }
      queryKey: unknown[]
    }
    expect(todayOptions.queryKey[4]).toBe('member:member-1')
    expect(todayOptions.input(null).query).toMatchObject({
      actor_id: 'dify-account:member-1',
      actor_type: 'member',
      from_at: expect.any(String),
      to_at: expect.any(String),
    })
    expect(dayjs(todayOptions.input(null).query.from_at as string).isSame(dayjs(), 'day')).toBe(
      true,
    )
  })

  it('shows safe activity details and relative times for today in the drawer', async () => {
    const user = userEvent.setup()
    queryData.activity.data[0]!.action = 'source.failed'
    queryData.activity.data[0]!.details = { reasonCode: 'CREDENTIALS_EXPIRED' }
    queryData.activity.data[0]!.occurred_at = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    queryData.activity.data[0]!.result = 'failure'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.overview.allActivity' }))

    const dialog = screen.getByRole('dialog', {
      name: 'knowledgeSpace.overview.allActivity',
    })
    expect(dialog).toHaveTextContent('Credentials expired')
    expect(dialog).toHaveTextContent('knowledgeSpace.overview.activityFailed')
    expect(within(dialog).getByText(/2h ago|2 hr\. ago|2 hours ago/)).toBeInTheDocument()
  })

  it('shows one initiated query activity with its question and retrieval mode', async () => {
    const user = userEvent.setup()
    queryData.activity.data[0]!.action = 'query.requested'
    queryData.activity.data[0]!.details = {
      mode: 'research',
      question: 'How do permissions work?',
    }
    queryData.activity.data[0]!.result = 'success'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const label = 'knowledgeSpace.qualityPage.question: How do permissions work? — research'
    expect(within(screen.getByRole('table')).getByText(label)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.overview.allActivity' }))
    expect(within(screen.getByRole('dialog')).getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.activityQueued')).not.toBeInTheDocument()
  })

  it('refreshes overview snapshots until they catch up with a completed background task', () => {
    queryData.tasks[0]!.state = 'running'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:00:00Z'
    const rendered = renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)
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

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.noSources' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.overview.connectSource' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/sources/new')
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.overview.uploadFiles' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/documents?upload=1')
    expect(screen.getAllByText('—')).toHaveLength(5)
    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.needsAttention' }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.overview.noQueryData')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.documentsEmptyTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.overview.allActivity' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('disables both onboarding entries after starting navigation', async () => {
    const user = userEvent.setup()
    queryData.stats.source_count = 0
    queryData.stats.documents = 0

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const connectSource = screen.getByRole('link', {
      name: 'knowledgeSpace.overview.connectSource',
    })
    const uploadFiles = screen.getByRole('link', {
      name: 'knowledgeSpace.overview.uploadFiles',
    })
    await user.click(connectSource)

    expect(connectSource).toHaveAttribute('aria-busy', 'true')
    expect(connectSource).toHaveAttribute('aria-disabled', 'true')
    expect(uploadFiles).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows a failed first-source task above onboarding and retries the real task', async () => {
    const user = userEvent.setup()
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    queryData.tasks[0]!.can_retry = true
    queryData.tasks[0]!.operation = 'document_upload'
    queryData.tasks[0]!.state = 'failed'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const overviewTitle = screen.getByRole('heading', {
      name: 'knowledgeSpace.overviewTitle',
    })
    const alert = screen.getByRole('alert')
    const onboardingTitle = screen.getByRole('heading', {
      name: 'knowledgeSpace.overview.noSources',
    })
    const onboarding = onboardingTitle.closest('section')

    expect(alert).toHaveTextContent('knowledgeSpace.documentUploadFailed')
    expect(overviewTitle.compareDocumentPosition(alert)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(alert.compareDocumentPosition(onboardingTitle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(onboarding).not.toBeNull()
    expect(within(onboarding!).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      within(onboarding!).getByText('knowledgeSpace.overview.noSourcesDescription'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retryTask' }))

    expect(retryTaskMutationState.mutateAsync).toHaveBeenCalledWith({
      params: {
        control_space_id: 'space-1',
        task_id: 'task-1',
        task_kind: 'source',
      },
    })
    expect(tasksQueryState.refetch).toHaveBeenCalledOnce()
  })

  it('keeps later document failures in Needs attention without showing the onboarding alert', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    queryData.tasks[0]!.can_retry = true
    queryData.tasks[0]!.operation = 'document_upload'
    queryData.tasks[0]!.state = 'failed'
    queryData.attention.data = [
      {
        action: {
          kind: 'open-resource',
          resource_id: 'document-1',
          resource_type: 'document',
        },
        evidence: [{ code: 'DOCUMENT_PROCESSING_FAILED', observed_at: '2026-07-29T08:00:00Z' }],
        issue_key: 'failed-document:document-1',
        knowledge_space_id: 'knowledge-1',
        resource: { id: 'document-1', type: 'document' },
        revision: 1,
        rule_id: 'failed-document',
        severity: 'critical',
        status: 'active',
        title: 'Document processing failed',
        updated_at: '2026-07-29T08:00:00Z',
      },
    ]

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByText('knowledgeSpace.overview.attention.failedDocument.title'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.overview.viewDocuments' }),
    ).toBeInTheDocument()
  })

  it('hides write-only onboarding actions for a read-only user', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    permissionState.datasetKeys = ['dataset.acl.readonly']
    permissionState.spaceKeys = ['knowledge_space_read']
    permissionState.workspaceKeys = ['dataset.acl.readonly']

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.overview.connectSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.overview.uploadFiles' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.overview.readOnlyDescription')).toBeInTheDocument()
  })

  it('uses the current space document-write permission for both onboarding actions', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    permissionState.datasetKeys = ['dataset.acl.readonly']
    permissionState.spaceKeys = ['knowledge_space_document_write']
    permissionState.workspaceKeys = ['dataset.external.connect']
    const rendered = renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.overview.connectSource' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.overview.uploadFiles' }),
    ).toBeInTheDocument()

    permissionState.datasetKeys = ['dataset.acl.edit']
    permissionState.spaceKeys = ['knowledge_space_read']
    permissionState.workspaceKeys = ['dataset.external.connect']
    rendered.rerender(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.overview.connectSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.overview.uploadFiles' }),
    ).not.toBeInTheDocument()
  })

  it('shows explicit section errors instead of healthy or zero-value fallbacks', () => {
    overviewQueryState.attention.isError = true
    overviewQueryState.inventory.isError = true

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const healthSection = screen
      .getByRole('heading', { name: 'knowledgeSpace.overview.needsAttention' })
      .closest('section')
    const inventorySection = screen
      .getByRole('heading', { name: 'knowledgeSpace.overview.inventory' })
      .closest('section')
    expect(healthSection).not.toBeNull()
    expect(inventorySection).not.toBeNull()
    expect(
      within(healthSection!).getByText('knowledgeSpace.detailErrorDescription'),
    ).toBeInTheDocument()
    expect(
      within(healthSection!).queryByText('knowledgeSpace.overview.noIssues'),
    ).not.toBeInTheDocument()
    expect(
      within(inventorySection!).getByText('knowledgeSpace.detailErrorDescription'),
    ).toBeInTheDocument()
  })

  it('shows overview data when uploaded documents exist without a connected source', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.overview.connectSource' }),
    ).not.toBeInTheDocument()
  })

  it('omits graph metrics from the knowledge inventory', () => {
    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSpace.overview.webCrawl')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.graphEntities')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.graphRelations')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.indexCoverage')).not.toBeInTheDocument()
  })

  it('shows first-indexing progress while the initial document task is running', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.progress_completed = 1
    queryData.tasks[0]!.progress_percent = 50
    queryData.tasks[0]!.progress_total = 2
    queryData.tasks[0]!.source_id = 'source-1'
    queryData.tasks[0]!.state = 'running'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', {
        name: 'knowledgeSpace.overview.indexingSource:{"source":"Notion — Support SOP"}',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('knowledgeSpace.overview.indexedDocuments:{"indexed":1,"total":2}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'knowledgeSpace.overview.indexing' }),
    ).toHaveAttribute('aria-valuenow', '1')
    expect(
      screen.queryByRole('heading', { name: 'knowledgeSpace.overview.noSources' }),
    ).not.toBeInTheDocument()
  })

  it('exposes first-indexing progress as indeterminate until the total is known', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 0
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.progress_completed = 0
    queryData.tasks[0]!.progress_percent = 0
    queryData.tasks[0]!.progress_total = 0
    queryData.tasks[0]!.state = 'queued'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    const progressbar = screen.getByRole('progressbar', {
      name: 'knowledgeSpace.overview.indexing',
    })
    expect(progressbar).not.toHaveAttribute('aria-valuemax')
    expect(progressbar).not.toHaveAttribute('aria-valuenow')
  })

  it('keeps the generic first-indexing title when the task has no source', () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.source_id = null
    queryData.tasks[0]!.state = 'running'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.overview.indexing' }),
    ).toBeInTheDocument()
  })

  it('shows the actual elapsed minutes for recent activity', () => {
    const now = Date.parse('2026-07-29T09:04:30Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    queryData.activity.data[0]!.occurred_at = '2026-07-29T08:05:00Z'

    renderOverviewWithNuqs(<KnowledgeOverviewPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('59 minutes ago')).toBeInTheDocument()
  })
})
