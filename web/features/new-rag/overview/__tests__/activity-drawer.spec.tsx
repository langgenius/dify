import type {
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsOverviewActivityResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ClientLink } from '@orpc/client'
import type { ConsoleClientContext } from '@/service/console'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { OverviewActivity } from '../overview-activity'
import { OverviewTaskSync } from '../overview-task-sync'
import { OverviewStateBoundary } from '../state-boundary'

type ActivityInput = { query: { from_at?: string } }

const service = vi.hoisted(() => ({
  drawerActivity: vi.fn(),
  tasks: vi.fn(),
}))

// Real generated query keys: the drawer must stay inside the task-sync invalidation boundary.
vi.mock('@/service/console', async () => {
  const { createORPCClient } = await import('@orpc/client')
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const link: ClientLink<ConsoleClientContext> = {
    call: async (path, input) => {
      switch (path.join('.')) {
        case 'knowledgeFs.spaces.byControlSpaceId.overview.activity.get':
          // Only the drawer bounds activity by date in a non-cloud edition.
          return (input as ActivityInput).query.from_at
            ? service.drawerActivity()
            : { data: [], next_cursor: null }
        case 'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get':
          return service.tasks()
        case 'knowledgeFs.spaces.byControlSpaceId.overview.stats.get':
          return { documents: 1, source_count: 1 }
        case 'knowledgeFs.spaces.byControlSpaceId.overview.inventory.get':
          return { index_coverage: { indexed: 1 } }
        case 'knowledgeFs.spaces.byControlSpaceId.overview.attention.get':
          return { data: [] }
        case 'workspaces.current.members.get':
          return { accounts: [] }
        default:
          return {}
      }
    },
  }
  return { consoleQuery: createConsoleQuery(createORPCClient(link)) }
})

function activity(id: string, count: number): KnowledgeFsOverviewActivityResponse {
  return {
    action: 'source.synced',
    actor: { id: 'system', type: 'system' },
    details: { count },
    id,
    occurred_at: new Date().toISOString(),
    resource: { id: 'source-1', type: 'source' },
    result: 'success',
  }
}

function task(
  state: KnowledgeFsBackgroundTaskResponse['state'],
): KnowledgeFsBackgroundTaskResponse {
  return {
    can_cancel: state === 'running',
    can_retry: false,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: state === 'running' ? '2026-09-08T00:00:00Z' : '2026-09-08T00:00:01Z',
    id: 'task-1',
    document_id: 'document-1',
    knowledge_space_id: 'space-a',
    operation: 'source_sync',
    progress_completed: 0,
    progress_failed: 0,
    progress_percent: 20,
    progress_total: 1,
    state,
    task_kind: 'source',
  }
}

const tasksKey = consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key()

describe('overview activity drawer', () => {
  let client: ReturnType<typeof createConsoleQueryClient>
  beforeEach(() => {
    vi.resetAllMocks()
    client = createConsoleQueryClient()
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    service.drawerActivity.mockResolvedValue({
      data: [activity('activity-1', 1)],
      next_cursor: null,
    })
  })
  async function openDrawer() {
    const user = userEvent.setup()
    // Only the drawer bounds activity by date outside the cloud edition.
    const { wrapper } = createConsoleQueryWrapper({
      queryClient: client,
      systemFeatures: { deployment_edition: 'ENTERPRISE' },
    })
    render(
      <QueryTestingAdapter>
        <OverviewStateBoundary knowledgeSpaceId="space-a">
          <OverviewTaskSync />
          <OverviewActivity />
        </OverviewStateBoundary>
      </QueryTestingAdapter>,
      { wrapper },
    )
    await user.click(
      await screen.findByRole('button', { name: 'knowledgeOverview.overview.allActivity' }),
    )
    return {
      user,
      drawer: await screen.findByRole('dialog', { name: 'knowledgeOverview.overview.allActivity' }),
    }
  }

  it('refreshes the open drawer when a background task completes', async () => {
    const { drawer } = await openDrawer()
    await waitFor(() => expect(service.drawerActivity).toHaveBeenCalledOnce())
    expect(await within(drawer).findAllByRole('listitem')).toHaveLength(1)

    service.drawerActivity.mockResolvedValue({
      data: [activity('activity-2', 2), activity('activity-1', 1)],
      next_cursor: null,
    })
    service.tasks.mockResolvedValue({ data: [task('completed')], next_cursor: null })
    await act(() => client.invalidateQueries({ queryKey: tasksKey }))

    await waitFor(() => expect(within(drawer).getAllByRole('listitem')).toHaveLength(2))
    expect(service.drawerActivity).toHaveBeenCalledTimes(2)
  })

  it('shows a retryable error instead of an empty result when the first request fails', async () => {
    service.drawerActivity.mockRejectedValueOnce(new Error('network error'))
    const { drawer, user } = await openDrawer()

    const alert = await within(drawer).findByRole('alert')
    expect(alert).toHaveTextContent('knowledgeSpace.tasksErrorDescription')
    expect(
      within(drawer).queryByText('knowledgeOverview.overview.noMatchingActivity'),
    ).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(within(drawer).getAllByRole('listitem')).toHaveLength(1))
    expect(within(drawer).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps loaded rows visible when a refresh fails', async () => {
    const { drawer } = await openDrawer()
    expect(await within(drawer).findAllByRole('listitem')).toHaveLength(1)

    service.drawerActivity.mockRejectedValueOnce(new Error('network error'))
    service.tasks.mockResolvedValue({ data: [task('completed')], next_cursor: null })
    await act(() => client.invalidateQueries({ queryKey: tasksKey }))

    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'knowledgeSpace.tasksErrorDescription',
    )
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(1)
  })
})
