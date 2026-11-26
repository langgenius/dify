import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
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
const emptyKnowledgeBase = () => {
  queryData.stats.source_count = 0
  queryData.stats.documents = 0
}

describe('KnowledgeOverviewPage onboarding', () => {
  beforeEach(async () => {
    await page.viewport(1280, 900)
    onTestFinished(installOverviewApi())
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
