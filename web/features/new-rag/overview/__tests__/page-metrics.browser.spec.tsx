import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
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

describe('KnowledgeOverviewPage metrics and readiness', () => {
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
    await expect.element(page.getByText('knowledgeOverview.overview.answered')).toBeVisible()
    await expect.element(page.getByText('knowledgeOverview.overview.lowConfidence')).toBeVisible()
    await expect.element(page.getByText('knowledgeOverview.overview.noEvidence')).toBeVisible()
    await release()
    await expect.element(page.getByText('86%')).toBeVisible()
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
})
