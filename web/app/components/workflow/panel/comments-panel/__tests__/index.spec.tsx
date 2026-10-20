import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import CommentsPanel from '../index'

const selectComment = vi.fn()
const resolveComment = vi.fn()
function setup() {
  const { queryClient } = createConsoleQueryWrapper({ accountProfile: { id: 'user-1' } })
  return renderWorkflowComponent(<CommentsPanel />, {
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

// Comment retrieval and canvas positioning are independent of the panel's filters.
vi.mock('../../../hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => ({
    comments: commentFixtures,
    loading: false,
    handleCommentIconClick: selectComment,
    handleCommentResolve: resolveComment,
  }),
}))

it('filters to the current user and routes the chosen thread', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.getByText('others resolved thread')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.aria.filterComments' }),
  )
  await user.click(
    screen.getByRole('button', { name: 'workflowComments.comments.filter.onlyYourThreads' }),
  )
  expect(screen.queryByText('others resolved thread')).not.toBeInTheDocument()
  await user.click(screen.getByText('my open thread'))
  expect(selectComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'c-1' }))
})

it('hides and restores resolved comments when the filter changes', async () => {
  const user = userEvent.setup()
  const { store } = setup()
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
