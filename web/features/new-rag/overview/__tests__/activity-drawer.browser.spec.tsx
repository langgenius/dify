import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  createOverviewActivity as activity,
  createOverviewTask as task,
} from '@/test/new-rag-overview'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { OverviewActivity } from '../overview-activity'
import { OverviewTaskSync } from '../overview-task-sync'
import { OverviewStateBoundary } from '../state-boundary'

const service = vi.hoisted(() => ({
  drawerActivity: vi.fn(),
  tasks: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createOverviewData } = await import('@/test/new-rag-overview')
  const data = createOverviewData()
  const overview = 'knowledgeFs.spaces.byControlSpaceId.overview'
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      // Only the drawer bounds activity by date outside the cloud edition.
      [`${overview}.activity.get`]: (input: { query: { from_at?: string } }) =>
        input.query.from_at ? service.drawerActivity() : { data: [], next_cursor: null },
      'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get': service.tasks,
      [`${overview}.stats.get`]: () => data.stats,
      [`${overview}.inventory.get`]: () => data.inventory,
      [`${overview}.attention.get`]: () => data.attention,
      'knowledgeFs.spaces.byControlSpaceId.overview.queryOutcomes.get': async () => data.outcomes,
      'workspaces.current.members.get': () => ({ accounts: [] }),
    }),
  }
})

describe('overview activity drawer', () => {
  let client: ReturnType<typeof createConsoleQueryClient>
  beforeEach(async () => {
    await page.viewport(640, 600)
    onTestFinished(guardUnexpectedFetch())
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    service.tasks.mockReset().mockResolvedValue({ data: [task('running')], next_cursor: null })
    service.drawerActivity.mockReset().mockResolvedValue({
      data: [activity('activity-1', 1)],
      next_cursor: null,
    })
    client = createConsoleQueryClient()
    onTestFinished(() => {
      client.clear()
      vi.useRealTimers()
    })
  })

  async function openDrawer() {
    const { wrapper: Wrapper } = createConsoleQueryWrapper({
      queryClient: client,
      systemFeatures: { deployment_edition: 'ENTERPRISE' },
    })
    await render(
      <Wrapper>
        <QueryTestingAdapter>
          <OverviewStateBoundary knowledgeSpaceId="space-a">
            <OverviewTaskSync />
            <OverviewActivity />
          </OverviewStateBoundary>
        </QueryTestingAdapter>
      </Wrapper>,
    )
    await page.getByRole('button', { name: 'knowledgeOverview.overview.allActivity' }).click()
    const drawer = page.getByRole('dialog', { name: 'knowledgeOverview.overview.allActivity' })
    await expect.element(drawer).toBeVisible()
    return drawer
  }

  it('shows newly completed activity in the open drawer and retains earlier rows', async () => {
    const drawer = await openDrawer()
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
    service.drawerActivity.mockResolvedValue({
      data: [activity('activity-2', 2), activity('activity-1', 1)],
      next_cursor: null,
    })
    service.tasks.mockResolvedValue({ data: [task('completed')], next_cursor: null })
    await vi.advanceTimersByTimeAsync(2000)

    await expect.element(drawer.getByText(/Synced 2 documents/)).toBeVisible()
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
    await expect.poll(() => drawer.getByRole('listitem').all()).toHaveLength(2)
  })

  it('retries a failed first request with a real control at a narrow viewport', async () => {
    service.drawerActivity.mockRejectedValueOnce(new Error('network error'))
    const drawer = await openDrawer()
    const alert = drawer.getByRole('alert')
    await expect.element(alert).toMatchTextContent('knowledgeSpace.tasksErrorDescription')
    await expect
      .element(drawer.getByText('knowledgeOverview.overview.noMatchingActivity'))
      .not.toBeInTheDocument()
    const retry = alert.getByRole('button', { name: 'common.operation.retry' })
    await retry.click()

    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
    await expect.element(alert).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByLabelText('knowledgeOverview.overview.allActivity'))
      .not.toBeInTheDocument()
  })

  it('keeps the loaded activity readable when a task-completion refresh fails', async () => {
    const drawer = await openDrawer()
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
    service.drawerActivity.mockRejectedValueOnce(new Error('network error'))
    service.tasks.mockResolvedValue({ data: [task('completed')], next_cursor: null })
    await vi.advanceTimersByTimeAsync(2000)

    await expect
      .element(drawer.getByRole('alert'))
      .toMatchTextContent('knowledgeSpace.tasksErrorDescription')
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
  })
})
