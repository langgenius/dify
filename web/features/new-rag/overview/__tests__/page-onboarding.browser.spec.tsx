import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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
const emptyKnowledgeBase = () => {
  queryData.stats.source_count = 0
  queryData.stats.documents = 0
}

describe('KnowledgeOverviewPage onboarding', () => {
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
})
