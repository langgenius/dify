import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import dayjs from 'dayjs'
import { page, userEvent } from 'vite-plus/test/browser'
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
    () =>
      structuredClone(data())
  return installFakeApi({
    console: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            backgroundTasks: {
              get: respond(() => ({ data: queryData.tasks, next_cursor: null })),
            },
            overview: {
              activity: { get: () => structuredClone(queryData.activity) },
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
            get: () => ({
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
            }),
          },
        },
      },
    },
  })
}
let fake: ReturnType<typeof installOverviewApi>
const activityCalls = () =>
  fake.console.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.mock.calls
const lastActivityQuery = () => activityCalls().at(-1)?.[0].query
const drawerActivityQueries = () =>
  activityCalls()
    .map(([input]) => input.query)
    .filter((query) => query && 'from_at' in query)
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
describe('KnowledgeOverviewPage activity', () => {
  beforeEach(async () => {
    await page.viewport(1280, 900)
    queryData = createOverviewData()
    fake = installOverviewApi()
    onTestFinished(fake)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it('shows the actual elapsed minutes for recent activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-07-29T09:04:30Z')
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
