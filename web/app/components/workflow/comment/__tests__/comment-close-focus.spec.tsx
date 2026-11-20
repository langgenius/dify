import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import {
  createPopoverHandle,
  Popover,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { useWorkflowComment } from '../../hooks/use-workflow-comment'
import { useStore } from '../../store'
import { CommentIcon } from '../comment-icon'
import { getCommentMarkerId } from '../marker-id'
import { CommentThread } from '../thread'
import { commentThreadPlacement } from '../thread-placement'

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
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
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

// Mirrors the canvas entry: markers are triggers of one thread popover.
function CommentCanvas() {
  const showUserComments = useStore((state) => state.showUserComments)
  const [threadHandle] = useState(() => createPopoverHandle())
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
  const activeIndex = activeComment
    ? comments.findIndex((item) => item.id === activeComment.id)
    : -1
  const open = activeComment !== null && activeIndex !== -1

  return (
    <div id="workflow-container">
      {comments.map((item) =>
        item.id === activeComment?.id || showUserComments ? (
          <CommentIcon
            key={item.id}
            comment={item}
            threadHandle={threadHandle}
            isActive={item.id === activeComment?.id}
            onPositionUpdate={(position) => handleCommentPositionUpdate(item.id, position)}
          />
        ) : null,
      )}
      <Popover
        handle={threadHandle}
        open={open}
        triggerId={open ? getCommentMarkerId(activeComment.id) : null}
        onOpenChange={(nextOpen, { trigger }) => {
          if (!nextOpen) return handleActiveCommentClose()
          const item = comments.find(
            (candidate) => getCommentMarkerId(candidate.id) === trigger?.id,
          )
          if (item) handleCommentIconClick(item)
        }}
      >
        <PopoverPortal>
          <PopoverPositioner {...commentThreadPlacement}>
            {open && (
              <CommentThread
                comment={activeComment}
                loading={activeCommentLoading}
                onReply={(content, ids) => handleCommentReply(activeComment.id, content, ids)}
                onPrev={activeIndex > 0 ? () => handleCommentNavigate('prev') : undefined}
                onNext={
                  activeIndex < comments.length - 1
                    ? () => handleCommentNavigate('next')
                    : undefined
                }
                canGoPrev={activeIndex > 0}
                canGoNext={activeIndex < comments.length - 1}
              />
            )}
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
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
  seedSystemFeatures(queryClient)
  return renderWorkflowFlowComponent(<CommentCanvas />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true },
    initialStoreState: {
      comments,
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

  it('keeps focus on navigation and restores the last viewed marker on close', async () => {
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
    const next = screen.getByRole('button', { name: /comments.aria.nextComment/ })
    expect(next).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText(otherComment.content)).toBeInTheDocument()
    // Navigation keeps focus on the header control so the next press keeps moving.
    expect(next).toHaveFocus()
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
