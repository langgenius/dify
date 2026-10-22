import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment } from 'react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { useWorkflowComment } from '../../hooks/use-workflow-comment'
import { useStore } from '../../store'
import { CommentIcon } from '../comment-icon'
import { CommentThread } from '../thread'

const mockFetchComments = vi.hoisted(() => vi.fn())
const mockFetchComment = vi.hoisted(() => vi.fn())
const mockUpdateComment = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: () => 'just now' }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onCommentsUpdate: () => () => {},
    emitCommentsUpdate: vi.fn(),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflow.comments.get': mockFetchComments,
      'apps.byAppId.workflow.comments.byCommentId.get': mockFetchComment,
      'apps.byAppId.workflow.comments.byCommentId.put': mockUpdateComment,
    }),
  }
})

const comment: WorkflowCommentBasic = {
  id: 'comment-1',
  position_x: 10,
  position_y: 20,
  content: 'Check this workflow',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: null,
  },
  created_at: 100,
  updated_at: 100,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
}

function CommentCanvas() {
  const showUserComments = useStore((state) => state.showUserComments)
  const {
    comments,
    activeComment,
    activeCommentLoading,
    handleCommentIconClick,
    handleActiveCommentClose,
    handleCommentReply,
    handleCommentPositionUpdate,
    handleCommentNavigate,
  } = useWorkflowComment()

  return (
    <div id="workflow-container">
      {comments.map((item, index) => {
        // Match Workflow's active/inactive branches: opening and closing rebuild the marker.
        if (activeComment?.id === item.id) {
          return (
            <Fragment key={item.id}>
              <CommentIcon
                key={`${item.id}-icon`}
                comment={item}
                onClick={() => handleCommentIconClick(item)}
                isActive
                onPositionUpdate={(position) => handleCommentPositionUpdate(item.id, position)}
              />
              <CommentThread
                key={`${item.id}-thread`}
                comment={activeComment}
                loading={activeCommentLoading}
                onClose={handleActiveCommentClose}
                onReply={(content, ids) => handleCommentReply(item.id, content, ids)}
                onPrev={index > 0 ? () => handleCommentNavigate('prev') : undefined}
                onNext={
                  index < comments.length - 1 ? () => handleCommentNavigate('next') : undefined
                }
                canGoPrev={index > 0}
                canGoNext={index < comments.length - 1}
              />
            </Fragment>
          )
        }

        return showUserComments ? (
          <CommentIcon
            key={item.id}
            comment={item}
            onClick={() => handleCommentIconClick(item)}
            onPositionUpdate={(position) => handleCommentPositionUpdate(item.id, position)}
          />
        ) : null
      })}
    </div>
  )
}

function renderCommentCanvas(comments = [comment]) {
  mockFetchComments.mockResolvedValue({ data: comments })
  mockFetchComment.mockImplementation(({ params }: { params: { comment_id: string } }) =>
    Promise.resolve({
      ...comments.find((item) => item.id === params.comment_id),
      mentions: [],
      replies: [],
    }),
  )
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1', name: 'Alice' })
  seedSystemFeatures(queryClient, { enable_collaboration_mode: true })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    { data: comments },
  )
  return renderWorkflowFlowComponent(<CommentCanvas />, {
    queryClient,
    initialStoreState: {
      showUserComments: true,
      mentionableUsersCache: { 'app-1': [] },
    },
  })
}

describe('Comment keyboard focus lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateComment.mockResolvedValue({})
  })

  it.each([
    { open: 'Enter', key: '{Enter}', close: 'Escape' },
    { open: 'Space', key: ' ', close: 'Escape' },
    { open: 'Enter', key: '{Enter}', close: 'close button' },
  ])(
    'restores the current marker after $open and $close, so arrow keys still move it',
    async ({ key, close }) => {
      const user = userEvent.setup()
      renderCommentCanvas()

      screen.getByRole('button', { name: /keyboard.openComment/ }).focus()
      expect(screen.getByRole('button', { name: /keyboard.openComment/ })).toHaveFocus()
      await user.keyboard(key)

      const reply = await screen.findByRole('textbox')
      await waitFor(() => expect(reply).toHaveFocus())
      if (close === 'Escape') {
        await user.keyboard('{Escape}')
      } else {
        await user.tab({ shift: true })
        await user.tab({ shift: true })
        expect(screen.getByRole('button', { name: /comments.aria.closeComment/ })).toHaveFocus()
        await user.keyboard('{Enter}')
      }

      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /keyboard.openComment/ })).toHaveFocus()
      })
      await user.keyboard('{ArrowRight}')

      await waitFor(() => {
        expect(mockUpdateComment).toHaveBeenCalledWith({
          params: { app_id: 'app-1', comment_id: comment.id },
          body: { content: comment.content, position_x: 15, position_y: 20 },
        })
      })
    },
  )

  it.each(['actions menu', 'mention suggestions'] as const)(
    'closes %s before the thread and restores its marker on the next Escape',
    async (surface) => {
      const user = userEvent.setup()
      const { store } = renderCommentCanvas()
      act(() => {
        store
          .getState()
          .setMentionableUsersCache('app-1', [
            { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null },
          ])
      })

      screen.getByRole('button', { name: /keyboard.openComment/ }).focus()
      await user.keyboard('{Enter}')
      const reply = await screen.findByRole('textbox')
      await waitFor(() => expect(reply).toHaveFocus())

      const commentActions = screen.getByRole('button', { name: /comments.aria.commentActions/ })
      if (surface === 'actions menu') {
        await user.click(commentActions)
        expect(await screen.findByRole('menu')).toBeInTheDocument()
      } else {
        await user.type(reply, '@Bo')
        expect(await screen.findByText('bob@example.com')).toBeInTheDocument()
      }

      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await waitFor(() => {
        expect(surface === 'actions menu' ? commentActions : reply).toHaveFocus()
      })

      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: /keyboard.openComment/ })).toHaveFocus()
    },
  )

  it('restores the last viewed comment marker after navigating to another thread', async () => {
    const user = userEvent.setup()
    const otherComment: WorkflowCommentBasic = {
      ...comment,
      id: 'comment-2',
      content: 'Another comment',
      created_by: 'user-2',
      created_by_account: {
        id: 'user-2',
        name: 'Bob',
        email: 'bob@example.com',
        avatar_url: null,
      },
    }
    renderCommentCanvas([comment, otherComment])
    screen.getAllByRole('button', { name: /keyboard.openComment/ })[0]!.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())

    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: /comments.aria.nextComment/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
    expect(screen.getByText(otherComment.content)).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /keyboard.openComment.*Bob/ })).toHaveFocus()
  })

  it('closes safely when comment markers have been hidden', async () => {
    const user = userEvent.setup()
    const { store } = renderCommentCanvas()
    screen.getAllByRole('button', { name: /keyboard.openComment/ })[0]!.focus()
    await user.keyboard('{Enter}')
    const reply = await screen.findByRole('textbox')
    await waitFor(() => expect(reply).toHaveFocus())

    act(() => store.getState().setShowUserComments(false))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /keyboard.openComment/ })).not.toBeInTheDocument()
  })
})
