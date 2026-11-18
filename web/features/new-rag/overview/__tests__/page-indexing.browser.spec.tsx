import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { createOverviewData } from '@/test/new-rag-overview'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
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

const server = {
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
}

function installOverviewApi() {
  const respond =
    <T,>(resource: OverviewResource, data: () => T) =>
    async (input: unknown): Promise<T> => {
      server.calls[resource](input)
      await server.held.get(resource)
      if (server.failing.has(resource))
        throw apiError('SERVICE_UNAVAILABLE', 503, `${resource} unavailable`)
      return structuredClone(data())
    }
  onTestFinished(
    installFakeApi({
      console: {
        knowledgeFs: {
          spaces: {
            byControlSpaceId: {
              backgroundTasks: {
                get: respond('tasks', () => ({ data: queryData.tasks, next_cursor: null })),
              },
              sources: {
                bySourceId: {
                  get: respond('source', () => ({
                    created_at: '2026-07-29T08:00:00Z',
                    id: 'source-1',
                    knowledge_space_id: 'knowledge-1',
                    metadata: {},
                    permission_scope: [],
                    status: 'active' as const,
                    type: 'connector' as const,
                    updated_at: '2026-07-29T08:00:00Z',
                    uri: 'notion://support-sop',
                    version: 1,
                    ...queryData.source,
                  })),
                },
              },
              overview: {
                activity: { get: respond('activity', () => queryData.activity) },
                attention: { get: respond('attention', () => queryData.attention) },
                inventory: { get: respond('inventory', () => queryData.inventory) },
                queryOutcomes: { get: respond('outcomes', () => queryData.outcomes) },
                stats: { get: respond('stats', () => queryData.stats) },
              },
              settings: {
                get: () => ({
                  active_profile_available: true,
                  active_profile_revisions: { embedding: 1, retrieval: 1 },
                  capabilities: {
                    deep: true,
                    index: true,
                    ingest: true,
                    query: true,
                    research: true,
                    source_sync: true,
                  },
                  configuration_state: 'active',
                  embedding: null,
                  issues: [],
                  retrieval: null,
                  revision: 1,
                }),
              },
            },
          },
        },
        workspaces: {
          current: {
            members: {
              get: respond('members', () => ({
                accounts: [
                  {
                    avatar_url: null,
                    email: 'ada@example.com',
                    id: 'member-1',
                    name: 'Ada',
                    role: 'normal',
                    status: 'active',
                  },
                ],
              })),
            },
          },
        },
      },
    }),
  )
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

describe('KnowledgeOverviewPage indexing', () => {
  beforeEach(async () => {
    await page.viewport(1280, 900)
    installOverviewApi()
    server.failing.clear()
    server.held.clear()
    queryData = createOverviewData()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // TODO(https://github.com/langgenius/dify/issues/46699): stats keep polling after tasks finish.
  it.fails('keeps refreshing visible metrics until the snapshot catches up with the completed task', async () => {
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
