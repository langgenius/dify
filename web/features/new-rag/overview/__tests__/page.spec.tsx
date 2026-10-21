import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { KnowledgeOverviewPage } from '../page'

vi.mock('../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

// Query-cache synchronization is exercised with real Query/Jotai in task-sync.spec.tsx.
vi.mock('../overview-task-sync', () => ({ OverviewTaskSync: () => null }))

// ECharts needs a canvas; the overview only owns the data it hands to the chart.
vi.mock('echarts-for-react', () => ({
  default: () => <div aria-label="query outcomes chart" />,
}))

type OverviewResource =
  | 'activity'
  | 'attention'
  | 'inventory'
  | 'members'
  | 'outcomes'
  | 'source'
  | 'stats'
  | 'tasks'

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

const server = vi.hoisted(() => ({
  calls: {
    activity: vi.fn(),
    attention: vi.fn(),
    inventory: vi.fn(),
    members: vi.fn(),
    outcomes: vi.fn(),
    source: vi.fn(),
    stats: vi.fn(),
    tasks: vi.fn(),
  },
  failing: new Set<string>(),
  held: new Map<string, Promise<void>>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const respond =
    (resource: OverviewResource, data: () => unknown) =>
    async (input: unknown): Promise<unknown> => {
      server.calls[resource](input)
      await server.held.get(resource)
      if (server.failing.has(resource)) throw new Error(`${resource} unavailable`)
      return structuredClone(data())
    }
  const overview = 'knowledgeFs.spaces.byControlSpaceId.overview'
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get': respond('tasks', () => ({
        data: queryData.tasks,
        next_cursor: null,
      })),
      'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get': respond(
        'source',
        () => queryData.source,
      ),
      [`${overview}.activity.get`]: respond('activity', () => queryData.activity),
      [`${overview}.attention.get`]: respond('attention', () => queryData.attention),
      [`${overview}.inventory.get`]: respond('inventory', () => queryData.inventory),
      [`${overview}.queryOutcomes.get`]: respond('outcomes', () => queryData.outcomes),
      [`${overview}.stats.get`]: respond('stats', () => queryData.stats),
      'workspaces.current.members.get': respond('members', () => ({
        accounts: [
          {
            avatar_url: 'https://example.com/avatar.png',
            email: 'ada@example.com',
            id: 'member-1',
            name: 'Ada',
          },
        ],
      })),
    }),
  }
})

type ActivityQuery = Record<string, unknown>
const lastActivityQuery = () =>
  (server.calls.activity.mock.lastCall?.[0] as { query: ActivityQuery } | undefined)?.query
const drawerActivityQueries = () =>
  server.calls.activity.mock.calls
    .map(([input]) => (input as { query: ActivityQuery }).query)
    .filter((query) => 'from_at' in query)

/** Holds a resource's responses open until the returned release function is called. */
function hold(resource: OverviewResource) {
  const gate = createDeferred<void>()
  server.held.set(resource, gate.promise)
  return async () => {
    server.held.delete(resource)
    await act(async () => gate.resolve())
  }
}

async function renderOverview({
  deploymentEdition = 'COMMUNITY',
  searchParams = '',
  settle = true,
  spacePermissions = ['knowledge_space_document_write'],
}: {
  deploymentEdition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
  searchParams?: string
  settle?: boolean
  spacePermissions?: KnowledgeFsProductPermission[]
} = {}) {
  const onUrlUpdate = vi.fn()
  const view = renderWithConsoleQuery(
    <QueryTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <KnowledgeSpaceTestProvider
        space={createKnowledgeSpaceFixture({ permission_keys: spacePermissions })}
      >
        <KnowledgeOverviewPage knowledgeSpaceId="space-1" />
      </KnowledgeSpaceTestProvider>
    </QueryTestingAdapter>,
    {
      knowledgeFsFeatures: { upload_enabled: true },
      systemFeatures: { deployment_edition: deploymentEdition },
    },
  )
  if (settle) await waitFor(() => expect(view.queryClient.isFetching()).toBe(0))
  const refetch = async (path: () => readonly unknown[]) => {
    await act(() => view.queryClient.invalidateQueries({ queryKey: path() }))
  }
  return { ...view, onUrlUpdate, refetch }
}

const overviewKeys = {
  attention: () => consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.attention.get.key(),
  stats: () => consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.stats.get.key(),
  tasks: () => consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
}

const emptyKnowledgeBase = () => {
  queryData.stats.source_count = 0
  queryData.stats.documents = 0
}

describe('KnowledgeOverviewPage', () => {
  beforeEach(() => {
    server.failing.clear()
    server.held.clear()
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes the metrics queries when a user switches the overview range', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = await renderOverview()

    const sevenDayRadio = screen.getByRole('radio', {
      name: 'knowledgeOverview.overview.sevenDays',
    })
    await user.click(sevenDayRadio)

    expect(sevenDayRadio).toHaveAttribute('aria-checked', 'true')
    const sevenDays = { params: { control_space_id: 'space-1' }, query: { window: '7d' } }
    await waitFor(() => expect(server.calls.stats).toHaveBeenLastCalledWith(sevenDays))
    expect(server.calls.outcomes).toHaveBeenLastCalledWith(sevenDays)
    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('window')).toBe('7d')
      expect(urlUpdate?.options.history).toBe('push')
    })
  })

  it('restores the selected overview range from the URL', async () => {
    await renderOverview({ searchParams: '?window=30d' })

    expect(
      screen.getByRole('radio', { name: 'knowledgeOverview.overview.thirtyDays' }),
    ).toHaveAttribute('aria-checked', 'true')
    const thirtyDays = { params: { control_space_id: 'space-1' }, query: { window: '30d' } }
    expect(server.calls.stats).toHaveBeenLastCalledWith(thirtyDays)
    expect(server.calls.outcomes).toHaveBeenLastCalledWith(thirtyDays)
  })

  it('renders ratio fields from the API contract as percentages', async () => {
    await renderOverview()

    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('+100%')).toBeInTheDocument()
    expect(screen.getByText('+4 pp')).toBeInTheDocument()
  })

  it('keeps existing overview data visible during a background refresh', async () => {
    queryData.outcomes.buckets = [
      { answered: 8, low_confidence: 1, no_evidence: 1, start_at: '2026-07-29T09:00:00Z' },
    ]
    const { queryClient } = await renderOverview()
    hold('stats')
    hold('outcomes')

    act(() => {
      void queryClient.invalidateQueries({ queryKey: overviewKeys.stats() })
    })

    await waitFor(() => expect(queryClient.isFetching()).toBeGreaterThan(0))
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByLabelText('query outcomes chart')).toBeInTheDocument()
  })

  it('shows the member who performed an activity instead of a system placeholder', async () => {
    await renderOverview()

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeOverview.overview.system')).not.toBeInTheDocument()
  })

  it('keeps activities beyond the seventh row available in the recent activity list', async () => {
    const activity = queryData.activity.data[0]!
    queryData.activity.data.push(
      ...Array.from({ length: 7 }, (_, index) => ({ ...activity, id: `activity-${index + 2}` })),
    )

    await renderOverview()

    const recentActivity = screen.getByRole('table', {
      name: 'knowledgeOverview.overview.recentActivity',
    })
    expect(within(recentActivity).getAllByRole('row')).toHaveLength(9)
  })

  it('reveals resolved modules while waiting to decide the page empty state', async () => {
    emptyKnowledgeBase()
    const releases = (
      ['activity', 'attention', 'inventory', 'outcomes', 'stats', 'tasks'] as const
    ).map((resource) => [resource, hold(resource)] as const)
    const release = Object.fromEntries(releases)

    await renderOverview({ settle: false })

    expect(
      await screen.findByRole('radiogroup', { name: 'knowledgeOverview.overview.timeRange' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'knowledgeOverview.overview.noSources' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()

    await release.stats!()

    expect(await screen.findByText('84%')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'knowledgeOverview.overview.noSources' }),
    ).not.toBeInTheDocument()

    for (const [, releaseResource] of releases) await releaseResource()

    expect(
      await screen.findByRole('heading', { name: 'knowledgeOverview.overview.noSources' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'knowledgeOverview.overview.timeRange' }),
    ).not.toBeInTheDocument()
  })

  it('shows an activity error with a retry action instead of an empty state', async () => {
    const user = userEvent.setup()
    server.failing.add('activity')

    await renderOverview()

    expect(screen.getByText('knowledgeSpace.tasksErrorDescription')).toBeInTheDocument()
    const activitySection = screen
      .getByRole('heading', { name: 'knowledgeOverview.overview.recentActivity' })
      .closest('section')!
    server.failing.delete('activity')
    await user.click(
      within(activitySection).getByRole('button', { name: 'common.operation.retry' }),
    )

    expect(await within(activitySection).findByText('Ada')).toBeInTheDocument()
    expect(
      within(activitySection).queryByText('knowledgeOverview.overview.noActivity'),
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
    const { refetch } = await renderOverview()

    expect(
      screen.getAllByText('knowledgeOverview.overview.attention.staleSource.title'),
    ).toHaveLength(4)
    expect(screen.queryByText('Source 0 has not synced in 7 days')).not.toBeInTheDocument()
    expect(screen.getByText('knowledgeOverview.overview.blocker')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    queryData.attention.data = queryData.attention.data.slice(0, 1)
    await refetch(overviewKeys.attention)

    expect(await screen.findByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.pagination.previous' })).toBeDisabled()
  })

  it('explains model blockers and ignores retired permission-readiness responses', async () => {
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

    await renderOverview()

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
    await renderOverview()

    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))

    expect(
      await screen.findByRole('dialog', { name: 'knowledgeOverview.overview.allActivity' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }),
    ).toHaveTextContent('knowledgeOverview.overview.today')
    expect(
      screen.getByRole('combobox', { name: 'knowledgeOverview.overview.operator' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'knowledgeOverview.overview.timeRange' }),
    ).toBeInTheDocument()
  })

  it('requests the complete activity list only while its drawer is open', async () => {
    const user = userEvent.setup()
    await renderOverview()

    expect(drawerActivityQueries()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))

    await waitFor(() => expect(drawerActivityQueries()).toHaveLength(1))
  })

  it('restarts activity pagination when the date or operator filter changes', async () => {
    const user = userEvent.setup()
    await renderOverview()
    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))

    await user.click(screen.getByRole('combobox', { name: 'knowledgeOverview.overview.operator' }))
    await user.click(await screen.findByRole('option', { name: 'Ada' }))

    await waitFor(() =>
      expect(lastActivityQuery()).toMatchObject({
        actor_id: 'dify-account:member-1',
        actor_type: 'member',
        limit: 20,
      }),
    )
    expect(lastActivityQuery()).not.toHaveProperty('cursor')

    await user.click(screen.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }))
    await user.click(
      await screen.findByRole('option', { name: 'knowledgeOverview.overview.last90Days' }),
    )

    await waitFor(() =>
      expect(lastActivityQuery()).toMatchObject({
        actor_id: 'dify-account:member-1',
        from_at: dayjs().subtract(89, 'day').startOf('day').toISOString(),
      }),
    )
  })

  it('limits cloud activity filters to the most recent 90 calendar days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 8, 12))
    const user = userEvent.setup()
    const earliest = dayjs().subtract(89, 'day').startOf('day')

    await renderOverview({ deploymentEdition: 'CLOUD' })
    expect(lastActivityQuery()).toMatchObject({ from_at: earliest.toISOString() })
    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))
    await user.click(screen.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }))
    expect(
      screen.queryByRole('option', { name: 'knowledgeOverview.overview.allTime' }),
    ).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole('option', { name: 'knowledgeOverview.overview.last90Days' }),
    )
    await waitFor(() =>
      expect(lastActivityQuery()).toMatchObject({
        from_at: earliest.toISOString(),
        to_at: dayjs().endOf('day').toISOString(),
      }),
    )

    const ordinal = (day: number) => {
      const suffix =
        ['th', 'st', 'nd', 'rd'][day % 100 > 10 && day % 100 < 14 ? 0 : day % 10] ?? 'th'
      return `${day}${suffix}`
    }
    const calendarLabel = (date: dayjs.Dayjs) =>
      new RegExp(`${date.format('MMMM')} ${ordinal(date.date())}, ${date.year()}`)
    await user.click(
      screen.getByRole('button', { name: /knowledgeOverview\.overview\.timeRange start/ }),
    )
    expect(
      screen.getByRole('button', { name: calendarLabel(earliest.subtract(1, 'day')) }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: calendarLabel(earliest) })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: calendarLabel(earliest.add(1, 'day')) }))
    expect(
      screen.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }),
    ).toHaveTextContent('filter.period.custom')
    await waitFor(() =>
      expect(lastActivityQuery()?.from_at).toBe(earliest.add(1, 'day').toISOString()),
    )
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'preserves all-time activity queries for %s',
    async (deploymentEdition) => {
      const user = userEvent.setup()
      await renderOverview({ deploymentEdition })
      expect(lastActivityQuery()).not.toHaveProperty('from_at')
      await user.click(
        screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }),
      )
      await waitFor(() => expect(drawerActivityQueries()).toHaveLength(1))
      await user.click(
        screen.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }),
      )
      await user.click(
        await screen.findByRole('option', { name: 'knowledgeOverview.overview.allTime' }),
      )

      await waitFor(() => expect(server.calls.activity).toHaveBeenCalledTimes(3))
      expect(lastActivityQuery()).not.toHaveProperty('from_at')
      expect(lastActivityQuery()).not.toHaveProperty('to_at')
    },
  )

  it('polls overview snapshots until they catch up with a completed background task', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    queryData.tasks[0]!.state = 'running'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:00:00Z'
    const { refetch } = await renderOverview()
    const statsRequests = () => server.calls.stats.mock.calls.length
    const afterLoad = statsRequests()

    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(statsRequests()).toBe(afterLoad + 1)

    queryData.tasks[0]!.state = 'completed'
    await refetch(overviewKeys.tasks)
    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(statsRequests()).toBe(afterLoad + 2)

    queryData.stats.generated_at = '2026-07-29T10:01:00Z'
    await act(() => vi.advanceTimersByTimeAsync(2100))
    const caughtUp = statsRequests()
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(statsRequests()).toBe(caughtUp)
  })

  it.each([
    ['read-only member', ['knowledge_space_read'] satisfies KnowledgeFsProductPermission[], false],
    [
      'member with document-write access',
      ['knowledge_space_document_write'] satisfies KnowledgeFsProductPermission[],
      true,
    ],
  ])(
    'uses the space permission of a %s for onboarding actions',
    async (_, permissions, canWrite) => {
      emptyKnowledgeBase()

      await renderOverview({ spacePermissions: permissions })

      const connectSource = screen.queryByRole('link', {
        name: 'knowledgeOverview.overview.connectSource',
      })
      const uploadFiles = screen.queryByRole('link', {
        name: 'knowledgeOverview.overview.uploadFiles',
      })
      if (canWrite) {
        expect(connectSource).toBeInTheDocument()
        expect(uploadFiles).toBeInTheDocument()
      } else {
        expect(connectSource).not.toBeInTheDocument()
        expect(uploadFiles).not.toBeInTheDocument()
        expect(
          screen.getByText('knowledgeOverview.overview.readOnlyDescription'),
        ).toBeInTheDocument()
      }
    },
  )

  it('shows safe activity details and relative times for today in the drawer', async () => {
    // At midnight, "two hours ago" is yesterday and deliberately uses an absolute date.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0))
    const user = userEvent.setup()
    queryData.activity.data[0]!.action = 'source.failed'
    queryData.activity.data[0]!.details = { reasonCode: 'CREDENTIALS_EXPIRED' }
    queryData.activity.data[0]!.occurred_at = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    queryData.activity.data[0]!.result = 'failure'

    await renderOverview()
    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))

    const dialog = screen.getByRole('dialog', {
      name: 'knowledgeOverview.overview.allActivity',
    })
    expect(dialog).toHaveTextContent('Credentials expired')
    expect(dialog).toHaveTextContent('knowledgeOverview.overview.activityFailed')
    expect(within(dialog).getByText(/2h ago|2 hr\. ago|2 hours ago/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows one initiated query activity with its question and retrieval mode', async () => {
    const user = userEvent.setup()
    queryData.activity.data[0]!.action = 'query.requested'
    queryData.activity.data[0]!.details = {
      mode: 'research',
      question: 'How do permissions work?',
    }
    queryData.activity.data[0]!.result = 'success'

    await renderOverview()

    const label = 'knowledgeSpace.qualityPage.question: How do permissions work? — research'
    expect(within(screen.getByRole('table')).getByText(label)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))
    expect(within(screen.getByRole('dialog')).getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.activityQueued')).not.toBeInTheDocument()
  })

  it('offers source connection and direct upload when the knowledge base is empty', async () => {
    emptyKnowledgeBase()

    await renderOverview()

    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'knowledgeOverview.overview.connectSource' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/sources/new')
    expect(
      screen.getByRole('link', { name: 'knowledgeOverview.overview.uploadFiles' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/documents?upload=1')
    expect(screen.getAllByText('—')).toHaveLength(5)
    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeOverview.overview.noQueryData')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.documentsEmptyTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeOverview.overview.allActivity' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('disables both onboarding entries after starting navigation', async () => {
    const user = userEvent.setup()
    emptyKnowledgeBase()

    await renderOverview()

    const connectSource = screen.getByRole('link', {
      name: 'knowledgeOverview.overview.connectSource',
    })
    const uploadFiles = screen.getByRole('link', {
      name: 'knowledgeOverview.overview.uploadFiles',
    })
    await user.click(connectSource)

    expect(connectSource).toHaveAttribute('aria-busy', 'true')
    expect(connectSource).toHaveAttribute('aria-disabled', 'true')
    expect(uploadFiles).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps failed first-source tasks in Needs attention without a duplicate banner', async () => {
    emptyKnowledgeBase()
    queryData.tasks[0]!.can_retry = true
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.state = 'failed'

    await renderOverview()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.retryTask' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('knowledgeOverview.overview.attention.failedDocument.title'),
    ).toBeInTheDocument()
    expect(screen.queryByText('knowledgeOverview.overview.noIssues')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'knowledgeOverview.overview.viewDocuments' }),
    ).toBeInTheDocument()
  })

  it('shows explicit section errors instead of healthy or zero-value fallbacks', async () => {
    server.failing.add('attention')
    server.failing.add('inventory')

    await renderOverview()

    const healthSection = screen
      .getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' })
      .closest('section')
    const inventorySection = screen
      .getByRole('heading', { name: 'knowledgeOverview.overview.inventory' })
      .closest('section')
    expect(healthSection).not.toBeNull()
    expect(inventorySection).not.toBeNull()
    expect(
      within(healthSection!).getByText('knowledgeSpace.detailErrorDescription'),
    ).toBeInTheDocument()
    expect(
      within(healthSection!).queryByText('knowledgeOverview.overview.noIssues'),
    ).not.toBeInTheDocument()
    expect(
      within(inventorySection!).getByText('knowledgeSpace.detailErrorDescription'),
    ).toBeInTheDocument()
  })

  it('shows overview data when uploaded documents exist without a connected source', async () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1

    await renderOverview()

    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.recentActivity' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'knowledgeOverview.overview.connectSource' }),
    ).not.toBeInTheDocument()
  })

  it('omits graph metrics from the knowledge inventory', async () => {
    await renderOverview()

    expect(screen.getByText('knowledgeOverview.overview.webCrawl')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.graphEntities')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.graphRelations')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.overview.indexCoverage')).not.toBeInTheDocument()
  })

  it('shows first-indexing progress while the initial document task is running', async () => {
    emptyKnowledgeBase()
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.progress_completed = 1
    queryData.tasks[0]!.progress_percent = 50
    queryData.tasks[0]!.progress_total = 2
    queryData.tasks[0]!.source_id = 'source-1'
    queryData.tasks[0]!.state = 'running'

    await renderOverview()

    // The source name is a dependent request that starts once the indexing task is known.
    expect(
      await screen.findByRole('heading', {
        name: 'knowledgeOverview.overview.indexingSource:{"source":"Notion — Support SOP"}',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('knowledgeOverview.overview.indexedDocuments:{"indexed":1,"total":2}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'knowledgeOverview.overview.indexing' }),
    ).toHaveAttribute('aria-valuenow', '1')
    expect(
      screen.queryByRole('heading', { name: 'knowledgeOverview.overview.noSources' }),
    ).not.toBeInTheDocument()
  })

  it('exposes first-indexing progress as indeterminate until the total is known', async () => {
    emptyKnowledgeBase()
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.progress_completed = 0
    queryData.tasks[0]!.progress_percent = 0
    queryData.tasks[0]!.progress_total = 0
    queryData.tasks[0]!.state = 'queued'

    await renderOverview()

    const progressbar = screen.getByRole('progressbar', {
      name: 'knowledgeOverview.overview.indexing',
    })
    expect(progressbar).not.toHaveAttribute('aria-valuemax')
    expect(progressbar).not.toHaveAttribute('aria-valuenow')
  })

  it('keeps the generic first-indexing title when the task has no source', async () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.source_id = null
    queryData.tasks[0]!.state = 'running'

    await renderOverview()

    expect(
      screen.getByRole('heading', { name: 'knowledgeOverview.overview.indexing' }),
    ).toBeInTheDocument()
  })

  it('shows the actual elapsed minutes for recent activity', async () => {
    const now = Date.parse('2026-07-29T09:04:30Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    queryData.activity.data[0]!.occurred_at = '2026-07-29T08:05:00Z'

    await renderOverview()

    expect(screen.getByText('59 minutes ago')).toBeInTheDocument()
  })

  it.each([0, 1])(
    'shows document failures in Needs attention with %i visible documents',
    async (documents) => {
      queryData.stats.source_count = 0
      queryData.stats.documents = documents
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

      await renderOverview()

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('knowledgeOverview.overview.noIssues')).not.toBeInTheDocument()
      expect(
        screen.getByText('knowledgeOverview.overview.attention.failedDocument.title'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'knowledgeOverview.overview.viewDocuments' }),
      ).toBeInTheDocument()
    },
  )
})
