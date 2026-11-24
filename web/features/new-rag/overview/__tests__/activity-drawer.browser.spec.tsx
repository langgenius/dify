import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import {
  createOverviewActivity as activity,
  createOverviewData,
  createOverviewTask as task,
} from '@/test/new-rag-overview'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { OverviewActivity } from '../overview-activity'
import { OverviewTaskSync } from '../overview-task-sync'
import { OverviewStateBoundary } from '../state-boundary'

// Only the drawer bounds activity by date outside the cloud edition.
const drawerActivity = vi.fn()

describe('overview activity drawer', () => {
  function installOverviewApi() {
    const data = createOverviewData()
    return installFakeApi({
      console: {
        knowledgeFs: {
          spaces: {
            byControlSpaceId: {
              overview: {
                activity: {
                  get: ({ query }) =>
                    query?.from_at ? drawerActivity() : { data: [], next_cursor: null },
                },
                stats: { get: () => data.stats },
                inventory: { get: () => data.inventory },
                attention: { get: () => data.attention },
                queryOutcomes: { get: () => data.outcomes },
              },
              backgroundTasks: {
                get: async () => ({ data: [task('running')], next_cursor: null }),
              },
            },
          },
        },
        workspaces: { current: { members: { get: () => ({ accounts: [] }) } } },
      },
    })
  }
  let fake: ReturnType<typeof installOverviewApi>
  let client: ReturnType<typeof createConsoleQueryClient>
  beforeEach(async () => {
    await page.viewport(640, 600)
    fake = installOverviewApi()
    onTestFinished(fake)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    drawerActivity.mockReset().mockResolvedValue({
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
    drawerActivity.mockResolvedValue({
      data: [activity('activity-2', 2), activity('activity-1', 1)],
      next_cursor: null,
    })
    fake.console.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.mockResolvedValue({
      data: [task('completed')],
      next_cursor: null,
    })
    await vi.advanceTimersByTimeAsync(2000)

    await expect.element(drawer.getByText(/Synced 2 documents/)).toBeVisible()
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
    await expect.poll(() => drawer.getByRole('listitem').all()).toHaveLength(2)
  })

  it('retries a failed first request with a real control at a narrow viewport', async () => {
    drawerActivity.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'network error' }),
    )
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
    drawerActivity.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'network error' }),
    )
    fake.console.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.mockResolvedValue({
      data: [task('completed')],
      next_cursor: null,
    })
    await vi.advanceTimersByTimeAsync(2000)

    await expect
      .element(drawer.getByRole('alert'))
      .toMatchTextContent('knowledgeSpace.tasksErrorDescription')
    await expect.element(drawer.getByText(/Synced 1 documents/)).toBeVisible()
  })
})
