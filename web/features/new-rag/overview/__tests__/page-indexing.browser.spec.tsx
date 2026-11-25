import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { createOverviewData } from '@/test/new-rag-overview'
import { createTestNavigation } from '@/test/next-navigation'
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

let queryData = createOverviewData()

function installOverviewApi() {
  const respond =
    <T,>(data: () => T) =>
    async () =>
      structuredClone(data())
  return installFakeApi({
    console: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            backgroundTasks: {
              get: respond(() => ({ data: queryData.tasks, next_cursor: null })),
            },
            sources: {
              bySourceId: {
                get: respond(() => ({
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
              activity: { get: respond(() => queryData.activity) },
              attention: { get: respond(() => queryData.attention) },
              inventory: { get: respond(() => queryData.inventory) },
              queryOutcomes: { get: respond(() => queryData.outcomes) },
              stats: { get: respond(() => queryData.stats) },
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
            get: respond(() => ({
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
  })
}
let fake: ReturnType<typeof installOverviewApi>
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
  const { NavigationProvider } = createTestNavigation({
    url: `/datasets/new/space-1/overview${searchParams}`,
  })
  const view = await render(
    <NavigationProvider>
      <Wrapper>
        <QueryTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
          <KnowledgeSpaceTestProvider
            space={createKnowledgeSpaceFixture({ permission_keys: spacePermissions })}
          >
            <KnowledgeOverviewPage knowledgeSpaceId="space-1" />
          </KnowledgeSpaceTestProvider>
        </QueryTestingAdapter>
      </Wrapper>
    </NavigationProvider>,
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
    fake = installOverviewApi()
    onTestFinished(fake)
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
    const stats = fake.console.knowledgeFs.spaces.byControlSpaceId.overview.stats.get
    const caughtUp = stats.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(stats).toHaveBeenCalledTimes(caughtUp)
    await expect.element(page.getByText('13', { exact: true })).toBeVisible()
  })

  it('stops refreshing overview sections after the task request fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    fake.console.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.mockImplementation(
      async () => {
        throw apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'tasks unavailable' })
      },
    )
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    await expect.poll(() => queryClient.isFetching()).toBe(0)
    const overview = fake.console.knowledgeFs.spaces.byControlSpaceId.overview
    const calls = () => [overview.stats.get, overview.attention.get].map((m) => m.mock.calls.length)
    const settled = calls()
    await vi.advanceTimersByTimeAsync(6000)
    expect(calls()).toEqual(settled)
  })

  it('resumes refreshing visible metrics when tasks load after the task request failed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const tasks = fake.console.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get
    tasks.mockImplementationOnce(async () => {
      throw apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'tasks unavailable' })
    })
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    queryData.tasks[0]!.state = 'running'
    queryData.stats.queries.value = 11
    await queryClient.invalidateQueries({ queryKey: overviewKeys.tasks() })
    await expect.element(page.getByText('11', { exact: true })).toBeVisible()
    queryData.stats.queries.value = 12
    await vi.advanceTimersByTimeAsync(2000)
    await expect.element(page.getByText('12', { exact: true })).toBeVisible()
  })

  it('refreshes stopped metrics when tasks recover with only finished tasks', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const tasks = fake.console.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get
    tasks.mockImplementationOnce(async () => {
      throw apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'tasks unavailable' })
    })
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    queryData.tasks[0]!.state = 'completed'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:02:00Z'
    queryData.stats.queries.value = 11
    await queryClient.invalidateQueries({ queryKey: overviewKeys.tasks() })
    await expect.element(page.getByText('11', { exact: true })).toBeVisible()
  })

  it('refreshes stopped metrics when a task is first seen after it finished', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    queryData.stats.generated_at = '2026-07-29T10:01:00Z'
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    const stats = fake.console.knowledgeFs.spaces.byControlSpaceId.overview.stats.get
    const idle = stats.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(stats).toHaveBeenCalledTimes(idle)
    queryData.tasks.push({
      ...queryData.tasks[0]!,
      id: 'task-finished-elsewhere',
      state: 'completed',
      updated_at: '2026-07-29T10:02:00Z',
    })
    queryData.stats.queries.value = 11
    await queryClient.invalidateQueries({ queryKey: overviewKeys.tasks() })
    await expect.element(page.getByText('11', { exact: true })).toBeVisible()
  })

  it('resumes refreshing visible metrics when a task starts after polling stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    queryData.stats.generated_at = '2026-07-29T10:01:00Z'
    const { queryClient } = await renderOverview()
    await expect.element(page.getByText('10', { exact: true })).toBeVisible()
    const stats = fake.console.knowledgeFs.spaces.byControlSpaceId.overview.stats.get
    const idle = stats.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(stats).toHaveBeenCalledTimes(idle)
    queryData.tasks[0]!.state = 'running'
    queryData.tasks[0]!.updated_at = '2026-07-29T10:02:00Z'
    queryData.stats.queries.value = 11
    await queryClient.invalidateQueries({ queryKey: overviewKeys.tasks() })
    await expect.element(page.getByText('11', { exact: true })).toBeVisible()
    queryData.stats.queries.value = 12
    await vi.advanceTimersByTimeAsync(2000)
    await expect.element(page.getByText('12', { exact: true })).toBeVisible()
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
