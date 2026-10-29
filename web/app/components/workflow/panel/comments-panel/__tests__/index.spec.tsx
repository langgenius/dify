import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import CommentsPanel from '../index'

function setup() {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1' },
    systemFeatures: { enable_collaboration_mode: true },
  })
  return renderWorkflowFlowComponent(<CommentsPanel />, {
    queryClient,
    initialStoreState: { showResolvedComments: true },
  })
}

const commentFixtures: WorkflowCommentBasic[] = [
  {
    id: 'c-1',
    position_x: 10,
    position_y: 20,
    created_by: 'user-1',
    created_by_account: { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: '' },
    content: 'my open thread',
    created_at: 1,
    updated_at: 2,
    resolved: false,
    mention_count: 0,
    reply_count: 2,
    participants: [],
  },
  {
    id: 'c-2',
    position_x: 30,
    position_y: 40,
    created_by: 'user-2',
    created_by_account: { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: '' },
    content: 'others resolved thread',
    created_at: 3,
    updated_at: 4,
    resolved: true,
    mention_count: 0,
    reply_count: 0,
    participants: [],
  },
]

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: { onCommentsUpdate: () => () => {} },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflow.comments.get': async () => ({ data: commentFixtures }),
      'apps.byAppId.workflow.comments.byCommentId.get': async ({
        params,
      }: {
        params: { app_id: string; comment_id: string }
      }) => ({
        ...commentFixtures.find((comment) => comment.id === params.comment_id)!,
        replies: [],
        mentions: [],
      }),
    }),
  }
})

it('filters to the current user and routes the chosen thread', async () => {
  const user = userEvent.setup()
  const { store } = setup()
  expect(await screen.findByText('others resolved thread')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.filterComments' }),
  )
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.filter.onlyYourThreads' }),
  )
  expect(screen.queryByText('others resolved thread')).not.toBeInTheDocument()
  await user.click(screen.getByText('my open thread'))
  await waitFor(() => expect(store.getState().activeCommentDetailLoading).toBe(false))
  expect(store.getState()).toMatchObject({
    activeCommentId: 'c-1',
    activeCommentDetail: { id: 'c-1', content: 'my open thread', replies: [], mentions: [] },
    commentDetailCache: { 'c-1': { id: 'c-1' } },
  })
})

it('hides and restores resolved comments when the filter changes', async () => {
  const user = userEvent.setup()
  const { store } = setup()
  await screen.findByText('others resolved thread')
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.filterComments' }),
  )
  await user.click(screen.getByRole('switch'))
  expect(store.getState().showResolvedComments).toBe(false)
  expect(screen.queryByText('others resolved thread')).not.toBeInTheDocument()
  expect(screen.getByText('my open thread')).toBeInTheDocument()
  await user.click(screen.getByRole('switch'))
  expect(screen.getByText('others resolved thread')).toBeInTheDocument()
})
