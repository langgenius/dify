import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import dayjs from 'dayjs'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { createOverviewData } from '@/test/new-rag-overview'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeOverviewPage } from '../page'

vi.mock('@/next/link', () => ({
  default: ({ onClick, href, children, ...props }: import('react').ComponentProps<'a'>) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/datasets/new/space-1/overview',
  useRouter: () => ({ push: vi.fn() }),
}))

// Isolate the external chart renderer; retain the real page, Query/Jotai owners and chart surface.

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
let queryData = createOverviewData()

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
      'knowledgeFs.spaces.byControlSpaceId.settings.get': () => ({ configuration_state: 'active' }),
      'workspaces.current.members.get': respond('members', () => ({
        accounts: [
          {
            avatar_url: null,
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
  (
    server.calls.activity.mock.lastCall?.[0] as
      | {
          query: ActivityQuery
        }
      | undefined
  )?.query
const drawerActivityQueries = () =>
  server.calls.activity.mock.calls
    .map(
      ([input]) =>
        (
          input as {
            query: ActivityQuery
          }
        ).query,
    )
    .filter((query) => 'from_at' in query)
/** Holds a resource's responses open until the returned release function is called. */
function hold(resource: OverviewResource) {
  const gate = createDeferred<void>()
  server.held.set(resource, gate.promise)
  return async () => {
    server.held.delete(resource)
    gate.resolve()
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
  const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper({
    knowledgeFsFeatures: { upload_enabled: true },
    systemFeatures: { deployment_edition: deploymentEdition },
  })
  onTestFinished(() => queryClient.clear())
  const view = await render(
    <Wrapper>
      <QueryTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        <KnowledgeSpaceTestProvider
          space={createKnowledgeSpaceFixture({ permission_keys: spacePermissions })}
        >
          <KnowledgeOverviewPage knowledgeSpaceId="space-1" />
        </KnowledgeSpaceTestProvider>
      </QueryTestingAdapter>
    </Wrapper>,
  )
  if (settle) await expect.poll(() => queryClient.isFetching()).toBe(0)
  const refetch = async (path: () => readonly unknown[]) => {
    await queryClient.invalidateQueries({ queryKey: path() })
  }
  return { ...view, queryClient, onUrlUpdate, refetch }
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
  beforeEach(async () => {
    await page.viewport(1280, 900)
    onTestFinished(guardUnexpectedFetch())
    server.failing.clear()
    server.held.clear()
    queryData = createOverviewData()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes the metrics queries when a user switches the overview range', async () => {
    const { onUrlUpdate } = await renderOverview()
    const sevenDayRadio = page.getByRole('radio', {
      name: 'knowledgeOverview.overview.sevenDays',
    })
    await page.getByRole('radio', { name: 'knowledgeOverview.overview.twentyFourHours' }).click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(sevenDayRadio).toHaveFocus()
    await expect.element(sevenDayRadio).toHaveAttribute('aria-checked', 'true')
    const sevenDays = { params: { control_space_id: 'space-1' }, query: { window: '7d' } }
    await expect.poll(() => server.calls.stats).toHaveBeenLastCalledWith(sevenDays)
    expect(server.calls.outcomes).toHaveBeenLastCalledWith(sevenDays)
    await expect
      .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('window'))
      .toBe('7d')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('push')
  })

  it('restores the selected overview range from the URL', async () => {
    await renderOverview({ searchParams: '?window=30d' })
    await expect
      .element(page.getByRole('radio', { name: 'knowledgeOverview.overview.thirtyDays' }))
      .toHaveAttribute('aria-checked', 'true')
    const thirtyDays = { params: { control_space_id: 'space-1' }, query: { window: '30d' } }
    expect(server.calls.stats).toHaveBeenLastCalledWith(thirtyDays)
    expect(server.calls.outcomes).toHaveBeenLastCalledWith(thirtyDays)
  })

  it('renders ratio fields from the API contract as percentages', async () => {
    await renderOverview()
    await expect.element(page.getByText('84%')).toBeInTheDocument()
    await expect.element(page.getByText('+100%')).toBeInTheDocument()
    await expect.element(page.getByText('+4 pp')).toBeInTheDocument()
  })

  it('keeps existing overview data visible during a background refresh', async () => {
    queryData.outcomes.buckets = [
      {
        answered: 8,
        low_confidence: 1,
        no_evidence: 1,
        query_count: 10,
        start_at: '2026-07-29T09:00:00Z',
        end_at: '2026-07-29T10:00:00Z',
      },
    ]
    const { queryClient } = await renderOverview()
    const release = hold('stats')
    queryData.stats.answer_rate.value = 0.86
    void queryClient.invalidateQueries({ queryKey: overviewKeys.stats() })
    await expect.poll(() => queryClient.isFetching()).toBeGreaterThan(0)
    await expect.element(page.getByText('84%')).toBeInTheDocument()
    await expect.element(page.getByLabelText('query outcomes chart')).toBeInTheDocument()
    await release()
    await expect.element(page.getByText('86%')).toBeVisible()
  })

  it('shows the member who performed an activity instead of a system placeholder', async () => {
    await renderOverview()
    await expect.element(page.getByText('Ada')).toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeOverview.overview.system'))
      .not.toBeInTheDocument()
  })

  it('keeps activities beyond the seventh row available in the recent activity list', async () => {
    const activity = queryData.activity.data[0]!
    queryData.activity.data.push(
      ...Array.from({ length: 7 }, (_, index) => ({
        ...activity,
        id: `activity-${index + 2}`,
        details: { reasonCode: `Activity ${index + 2}` },
      })),
    )
    await renderOverview()
    const recentActivity = page.getByRole('table', {
      name: 'knowledgeOverview.overview.recentActivity',
    })
    await expect.poll(() => recentActivity.getByRole('row').all()).toHaveLength(9)
    await expect.element(recentActivity).toBeVisible()
    const table = recentActivity.element()
    const lastRow = recentActivity.getByRole('row').filter({ hasText: 'Activity 8' })
    await expect.element(lastRow).toBeInTheDocument()
    expect(table.scrollHeight).toBeGreaterThan(table.clientHeight)
    await recentActivity.wheel({ delta: { y: 1000 } })
    await expect
      .poll(() => {
        const row = lastRow.element().getBoundingClientRect()
        const viewport = table.getBoundingClientRect()
        return table.scrollTop > 0 && row.top >= viewport.top && row.bottom <= viewport.bottom
      })
      .toBe(true)
  })

  it('reveals resolved modules while waiting to decide the page empty state', async () => {
    emptyKnowledgeBase()
    const releases = (
      ['activity', 'attention', 'inventory', 'outcomes', 'stats', 'tasks'] as const
    ).map((resource) => [resource, hold(resource)] as const)
    const release = Object.fromEntries(releases)
    await renderOverview({ settle: false })
    await expect
      .element(page.getByRole('radiogroup', { name: 'knowledgeOverview.overview.timeRange' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' }))
      .toBeInTheDocument()
    await expect.element(page.getByText('84%')).not.toBeInTheDocument()
    await release.stats!()
    await expect.element(page.getByText('84%')).toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }))
      .not.toBeInTheDocument()
    for (const [, releaseResource] of releases) await releaseResource()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('radiogroup', { name: 'knowledgeOverview.overview.timeRange' }))
      .not.toBeInTheDocument()
  })

  it('shows an activity error with a retry action instead of an empty state', async () => {
    server.failing.add('activity')
    await renderOverview()
    await expect.element(page.getByText('knowledgeSpace.tasksErrorDescription')).toBeInTheDocument()
    server.failing.delete('activity')
    await page.getByRole('button', { name: 'common.operation.retry' }).click()
    await expect.element(page.getByText('Ada')).toBeInTheDocument()
    await expect
      .element(page.getByRole('table', { name: 'knowledgeOverview.overview.recentActivity' }))
      .toBeVisible()
    await expect
      .element(page.getByText('knowledgeSpace.tasksErrorDescription'))
      .not.toBeInTheDocument()
  })

  it('renders specific attention findings and clamps the page when polling removes issues', async () => {
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
    await expect
      .poll(() => page.getByText('knowledgeOverview.overview.attention.staleSource.title').all())
      .toHaveLength(4)
    await expect
      .element(page.getByText('Source 0 has not synced in 7 days'))
      .not.toBeInTheDocument()
    await expect.element(page.getByText('knowledgeOverview.overview.blocker')).toBeInTheDocument()
    await page.getByRole('button', { name: 'common.pagination.next' }).click()
    await expect.element(page.getByText('2 / 2')).toBeInTheDocument()
    queryData.attention.data = queryData.attention.data.slice(0, 1)
    await refetch(overviewKeys.attention)
    await expect.element(page.getByText('1 / 1')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'common.pagination.previous' }))
      .toBeDisabled()
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
    await expect
      .element(page.getByText('knowledgeSpace.overview.attention.modelReadiness.title'))
      .toBeInTheDocument()
    await expect
      .element(
        page.getByText(
          'knowledgeSpace.overview.attention.modelReadiness.profilesMissing knowledgeSpace.overview.attention.modelReadiness.bindingMissing',
        ),
      )
      .toBeInTheDocument()
    await expect
      .element(
        page.getByRole('button', {
          name: 'knowledgeSpace.overview.attention.action.configureModels',
        }),
      )
      .toHaveAttribute('href', '/datasets/new/space-1/settings')
    await expect
      .element(page.getByText('Retrieval model profile is not published'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('Knowledge-space permissions are not ready'))
      .not.toBeInTheDocument()
  })

  it('fetches complete activity on opening and removes the drawer before reopening', async () => {
    await renderOverview()
    const trigger = page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' })
    expect(drawerActivityQueries()).toEqual([])
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'knowledgeOverview.overview.allActivity' })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }))
      .toMatchTextContent('knowledgeOverview.overview.today')
    await expect
      .element(dialog.getByRole('combobox', { name: 'knowledgeOverview.overview.operator' }))
      .toBeVisible()
    await expect.poll(() => drawerActivityQueries().length).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByLabelText('knowledgeOverview.overview.allActivity'))
      .not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await trigger.click()
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByRole('listitem')).toBeVisible()
  })

  it('applies member and date filters to activity requests', async () => {
    await renderOverview()
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    await page.getByRole('combobox', { name: 'knowledgeOverview.overview.operator' }).click()
    await page.getByRole('option', { name: 'Ada' }).click()
    await expect
      .poll(() => lastActivityQuery())
      .toMatchObject({
        actor_id: 'dify-account:member-1',
        actor_type: 'member',
        limit: 20,
      })
    expect(lastActivityQuery()).not.toHaveProperty('cursor')
    await page.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }).click()
    await page.getByRole('option', { name: 'knowledgeOverview.overview.last90Days' }).click()
    await expect
      .poll(() => lastActivityQuery())
      .toMatchObject({
        actor_id: 'dify-account:member-1',
        from_at: dayjs().subtract(89, 'day').startOf('day').toISOString(),
      })
  })

  it('limits cloud activity filters to the most recent 90 calendar days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 8, 12))
    const earliest = dayjs().subtract(89, 'day').startOf('day')
    await renderOverview({ deploymentEdition: 'CLOUD' })
    expect(lastActivityQuery()).toMatchObject({ from_at: earliest.toISOString() })
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    await page.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }).click()
    await expect
      .element(page.getByRole('option', { name: 'knowledgeOverview.overview.allTime' }))
      .not.toBeInTheDocument()
    await page.getByRole('option', { name: 'knowledgeOverview.overview.last90Days' }).click()
    await expect
      .poll(() => lastActivityQuery())
      .toMatchObject({
        from_at: earliest.toISOString(),
        to_at: dayjs().endOf('day').toISOString(),
      })
    const ordinal = (day: number) => {
      const suffix =
        ['th', 'st', 'nd', 'rd'][day % 100 > 10 && day % 100 < 14 ? 0 : day % 10] ?? 'th'
      return `${day}${suffix}`
    }
    const calendarLabel = (date: dayjs.Dayjs) =>
      new RegExp(`${date.format('MMMM')} ${ordinal(date.date())}, ${date.year()}`)
    await page.getByRole('button', { name: /knowledgeOverview\.overview\.timeRange start/ }).click()
    await expect
      .element(page.getByRole('button', { name: calendarLabel(earliest.subtract(1, 'day')) }))
      .toBeDisabled()
    await expect.element(page.getByRole('button', { name: calendarLabel(earliest) })).toBeEnabled()
    await page.getByRole('button', { name: calendarLabel(earliest.add(1, 'day')) }).click()
    await expect
      .element(page.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }))
      .toMatchTextContent('filter.period.custom')
    await expect.poll(() => lastActivityQuery()?.from_at).toBe(earliest.add(1, 'day').toISOString())
  })

  it('preserves all-time activity queries outside cloud', async () => {
    const deploymentEdition = 'ENTERPRISE'
    await renderOverview({ deploymentEdition })
    expect(lastActivityQuery()).not.toHaveProperty('from_at')
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    await expect.poll(() => drawerActivityQueries()).toHaveLength(1)
    await page.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }).click()
    await page.getByRole('option', { name: 'knowledgeOverview.overview.allTime' }).click()
    await expect
      .element(page.getByRole('combobox', { name: 'knowledgeOverview.overview.timeRange' }))
      .toMatchTextContent('knowledgeOverview.overview.allTime')
    await expect.poll(() => lastActivityQuery()).not.toHaveProperty('from_at')
    expect(lastActivityQuery()).not.toHaveProperty('from_at')
    expect(lastActivityQuery()).not.toHaveProperty('to_at')
  })

  it('keeps refreshing visible metrics until the snapshot catches up with the completed task', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    queryData.tasks[0]!.state = 'running'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:00:00Z'
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    queryData.stats.queries.value = 11
    await vi.advanceTimersByTimeAsync(2000)
    await expect.element(page.getByText('11', { exact: true })).toBeVisible()
    queryData.tasks[0]!.state = 'completed'
    queryData.stats.queries.value = 12
    await queryClient.invalidateQueries({ queryKey: overviewKeys.tasks() })
    await vi.advanceTimersByTimeAsync(2000)
    await expect.element(page.getByText('12', { exact: true })).toBeVisible()
    queryData.stats.generated_at = '2026-07-29T10:01:00Z'
    queryData.stats.queries.value = 13
    await vi.advanceTimersByTimeAsync(2000)
    await expect.element(page.getByText('13', { exact: true })).toBeVisible()
    await expect.poll(() => queryClient.isFetching()).toBe(0)
    const caughtUp = server.calls.stats.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(server.calls.stats).toHaveBeenCalledTimes(caughtUp)
    await expect.element(page.getByText('13', { exact: true })).toBeVisible()
  })

  it('hides onboarding actions from a read-only member', async () => {
    emptyKnowledgeBase()
    await renderOverview({ spacePermissions: ['knowledge_space_read'] })
    await expect
      .element(page.getByRole('link', { name: 'knowledgeOverview.overview.connectSource' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'knowledgeOverview.overview.uploadFiles' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeOverview.overview.readOnlyDescription'))
      .toBeVisible()
  })

  it.each([
    ['document.failed', 'failure', 'text/plain', 'knowledgeOverview.overview.activityFailed'],
    [
      'document.published',
      'success',
      'application/pdf',
      'knowledgeOverview.overview.activityCompleted',
    ],
  ] as const)(
    'omits the file MIME type from %s in recent and all activity',
    async (action, result, documentType, label) => {
      queryData.activity.data[0]!.action = action
      queryData.activity.data[0]!.details = { documentType }
      queryData.activity.data[0]!.result = result
      await renderOverview()
      const recentActivity = page.getByRole('table', {
        name: 'knowledgeOverview.overview.recentActivity',
      })
      await expect.element(recentActivity.getByText(label, { exact: false })).toBeInTheDocument()
      await expect.element(recentActivity).not.toMatchTextContent(documentType)
      await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
      const dialog = page.getByRole('dialog', {
        name: 'knowledgeOverview.overview.allActivity',
      })
      await expect.element(dialog.getByText(label, { exact: false })).toBeInTheDocument()
      await expect.element(dialog).not.toMatchTextContent(documentType)
    },
  )

  it('shows safe activity details and relative times for today in the drawer', async () => {
    // At midnight, "two hours ago" is yesterday and deliberately uses an absolute date.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0))
    queryData.activity.data[0]!.action = 'source.failed'
    queryData.activity.data[0]!.details = { reasonCode: 'CREDENTIALS_EXPIRED' }
    queryData.activity.data[0]!.occurred_at = new Date(Date.now() - 2 * 60 * 60000).toISOString()
    queryData.activity.data[0]!.result = 'failure'
    await renderOverview()
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'knowledgeOverview.overview.allActivity',
    })
    await expect.element(dialog).toMatchTextContent('Credentials expired')
    await expect.element(dialog).toMatchTextContent('knowledgeOverview.overview.activityFailed')
    await expect.element(dialog.getByText(/2h ago|2 hr\. ago|2 hours ago/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows one initiated query activity with its question and retrieval mode', async () => {
    queryData.activity.data[0]!.action = 'query.requested'
    queryData.activity.data[0]!.details = {
      mode: 'research',
      question: 'How do permissions work?',
    }
    queryData.activity.data[0]!.result = 'success'
    await renderOverview()
    const label = 'knowledgeSpace.qualityPage.question: How do permissions work? — research'
    await expect.element(page.getByRole('table').getByText(label)).toBeInTheDocument()
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    await expect.element(page.getByRole('dialog').getByText(label)).toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSpace.overview.activityQueued'))
      .not.toBeInTheDocument()
  })

  it('offers source connection and direct upload when the knowledge base is empty', async () => {
    emptyKnowledgeBase()
    await renderOverview()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'knowledgeOverview.overview.connectSource' }))
      .toHaveAttribute('href', '/datasets/new/space-1/sources/new')
    await expect
      .element(page.getByRole('link', { name: 'knowledgeOverview.overview.uploadFiles' }))
      .toHaveAttribute('href', '/datasets/new/space-1/documents?upload=1')
    await expect.poll(() => page.getByText('—').all()).toHaveLength(5)
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeOverview.overview.noQueryData'))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.recentActivity' }))
      .toBeInTheDocument()
    await expect.element(page.getByText('knowledgeSpace.documentsEmptyTitle')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }))
      .not.toBeInTheDocument()
    await expect.element(page.getByRole('table')).not.toBeInTheDocument()
    await expect.element(page.getByRole('tablist')).not.toBeInTheDocument()
  })

  it('disables both onboarding entries after starting navigation', async () => {
    emptyKnowledgeBase()
    await renderOverview()
    const connectSource = page.getByRole('link', {
      name: 'knowledgeOverview.overview.connectSource',
    })
    const uploadFiles = page.getByRole('link', {
      name: 'knowledgeOverview.overview.uploadFiles',
    })
    await connectSource.click()
    await expect.element(connectSource).toHaveAttribute('aria-busy', 'true')
    await expect.element(connectSource).toHaveAttribute('aria-disabled', 'true')
    await expect.element(uploadFiles).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps failed first-source tasks in Needs attention without a duplicate banner', async () => {
    emptyKnowledgeBase()
    queryData.tasks[0]!.can_retry = true
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.state = 'failed'
    await renderOverview()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'knowledgeSpace.retryTask' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeOverview.overview.noIssues'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'knowledgeOverview.overview.viewDocuments' }))
      .toBeInTheDocument()
  })

  it('shows explicit section errors instead of healthy or zero-value fallbacks', async () => {
    server.failing.add('attention')
    server.failing.add('inventory')
    await renderOverview()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.needsAttention' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.inventory' }))
      .toBeVisible()
    await expect
      .poll(() => page.getByText('knowledgeSpace.detailErrorDescription').all())
      .toHaveLength(3)
    await expect
      .element(page.getByText('knowledgeOverview.overview.noIssues'))
      .not.toBeInTheDocument()
  })

  it('shows overview data when uploaded documents exist without a connected source', async () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    await renderOverview()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.recentActivity' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'knowledgeOverview.overview.connectSource' }))
      .not.toBeInTheDocument()
  })

  it('omits graph metrics from the knowledge inventory', async () => {
    await renderOverview()
    await expect
      .element(
        page.getByRole('listitem').filter({ hasText: 'knowledgeOverview.overview.webCrawl' }),
      )
      .toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSpace.overview.graphEntities'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSpace.overview.graphRelations'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSpace.overview.indexCoverage'))
      .not.toBeInTheDocument()
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
    await // The source name is a dependent request that starts once the indexing task is known.
    await expect
      .element(
        await page.getByRole('heading', {
          name: 'knowledgeOverview.overview.indexingSource:{"source":"Notion — Support SOP"}',
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(
        page.getByText('knowledgeOverview.overview.indexedDocuments:{"indexed":1,"total":2}'),
      )
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('progressbar', { name: 'knowledgeOverview.overview.indexing' }))
      .toHaveAttribute('aria-valuenow', '1')
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.noSources' }))
      .not.toBeInTheDocument()
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
    const progressbar = page.getByRole('progressbar', {
      name: 'knowledgeOverview.overview.indexing',
    })
    await expect.element(progressbar).not.toHaveAttribute('aria-valuemax')
    await expect.element(progressbar).not.toHaveAttribute('aria-valuenow')
  })

  it('keeps the generic first-indexing title when the task has no source', async () => {
    queryData.stats.source_count = 0
    queryData.stats.documents = 1
    queryData.inventory.index_coverage.indexed = 0
    queryData.tasks[0]!.operation = 'document_processing'
    queryData.tasks[0]!.source_id = null
    queryData.tasks[0]!.state = 'running'
    await renderOverview()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeOverview.overview.indexing' }))
      .toBeInTheDocument()
  })

  it('shows the actual elapsed minutes for recent activity', async () => {
    const now = Date.parse('2026-07-29T09:04:30Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    queryData.activity.data[0]!.occurred_at = '2026-07-29T08:05:00Z'
    await renderOverview()
    await expect.element(page.getByText('59 minutes ago')).toBeInTheDocument()
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
      await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
      await expect
        .element(page.getByText('knowledgeOverview.overview.noIssues'))
        .not.toBeInTheDocument()
      await expect
        .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
        .toBeInTheDocument()
      await expect
        .element(page.getByRole('button', { name: 'knowledgeOverview.overview.viewDocuments' }))
        .toBeInTheDocument()
    },
  )
})
