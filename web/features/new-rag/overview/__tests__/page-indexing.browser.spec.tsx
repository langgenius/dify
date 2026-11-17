import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
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

// boundary: ECharts is an external renderer; the page's real chart surface remains asserted.
vi.mock('echarts-for-react/esm/core', () => ({
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

describe('KnowledgeOverviewPage indexing', () => {
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
})
