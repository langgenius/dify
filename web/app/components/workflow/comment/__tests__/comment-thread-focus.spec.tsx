import type { UserProfile, WorkflowCommentDetail, WorkflowCommentList } from '../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import { CommentIcon } from '../comment-icon'
import { CommentInput } from '../comment-input'
import { CommentThread } from '../thread'

const storeState = vi.hoisted(() => ({
  mentionableUsersCache: { 'app-1': [] } as Record<string, UserProfile[]>,
  setCommentPreviewHovering: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    flowToScreenPosition: (position: { x: number; y: number }) => position,
    screenToFlowPosition: (position: { x: number; y: number }) => position,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

vi.mock('../../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  useWorkflowStore: () => ({ getState: () => storeState }),
}))

const createComment = (): WorkflowCommentDetail & WorkflowCommentList => ({
  id: 'comment-1',
  position_x: 120,
  position_y: 80,
  content: 'Move this comment',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: null,
  },
  created_at: 1,
  updated_at: 2,
  resolved: false,
  mentions: [],
  replies: [],
  mention_count: 0,
  reply_count: 0,
  participants: [],
})

describe('Comment thread focus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.mentionableUsersCache['app-1'] = []
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['draft', 'thread'] as const)(
    'dismisses mentions before closing the %s',
    async (kind) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClose = vi.fn()
      storeState.mentionableUsersCache['app-1'] = [
        { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null },
      ]
      renderWithAccountProfile(
        kind === 'draft' ? (
          <CommentInput position={{ x: 0, y: 0 }} onSubmit={() => {}} onCancel={onClose} />
        ) : (
          <CommentThread comment={createComment()} onClose={onClose} onReply={() => {}} />
        ),
      )
      await user.click(screen.getByRole('textbox'))
      await user.type(screen.getByRole('textbox'), '@')
      expect(screen.getByText('Bob')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByText('Bob')).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps focus on the marker after saving a keyboard move with its thread open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onPositionUpdate = vi.fn()

    function Comment() {
      const [comment, setComment] = useState(createComment)
      const [opened, setOpened] = useState(false)
      return (
        <div id="workflow-container">
          <CommentIcon
            comment={comment}
            isActive={opened}
            onClick={() => setOpened(true)}
            onPositionUpdate={(position) => {
              onPositionUpdate(position)
              setComment((current) => ({
                ...current,
                position_x: position.x,
                position_y: position.y,
              }))
            }}
          />
          {opened && (
            <CommentThread comment={comment} onClose={() => setOpened(false)} onReply={() => {}} />
          )}
        </div>
      )
    }

    renderWithAccountProfile(<Comment />)
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
    await user.tab()
    await user.keyboard('{Enter}')
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal', 'true')

    act(() => marker.focus())
    await user.keyboard('{ArrowRight}')
    expect(onPositionUpdate).toHaveBeenLastCalledWith({ x: 125, y: 80 })
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(marker).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(onPositionUpdate).toHaveBeenLastCalledWith({ x: 125, y: 85 })
    expect(onPositionUpdate).toHaveBeenCalledTimes(2)
  })

  it('confirms reply deletion outside the menu and restores focus when cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onDelete = vi.fn()
    const onClose = vi.fn()
    const comment = createComment()
    comment.replies = [
      {
        id: 'reply-1',
        content: 'A reply',
        created_at: 2,
        created_by: 'user-1',
        created_by_account: comment.created_by_account,
      },
    ]
    renderWithAccountProfile(
      <CommentThread
        comment={comment}
        onClose={onClose}
        onReply={() => {}}
        onReplyEdit={() => {}}
        onReplyDeleteDirect={onDelete}
      />,
    )
    await act(() => vi.advanceTimersByTimeAsync(100))
    const trigger = screen.getByRole('button', {
      name: 'workflowComments.comments.aria.replyActions',
    })
    await user.click(trigger)
    const deleteItem = screen.getByRole('menuitem', {
      name: 'workflowComments.comments.actions.deleteReply',
    })
    await user.click(deleteItem)
    const confirm = await screen.findByRole('alertdialog', {
      name: 'workflowComments.comments.actions.deleteReply',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onClose).not.toHaveBeenCalled()
    await user.click(trigger)
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'workflowComments.comments.actions.deleteReply',
      }),
    )
    const reopened = await screen.findByRole('alertdialog')
    await user.click(within(reopened).getByRole('button', { name: 'common.operation.delete' }))
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('reply-1')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps reply deletion pending until the reply disappears, then focuses the reply input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onDelete = vi.fn()
    let finishDeletion!: () => void
    const deletion = new Promise<void>((resolve) => {
      finishDeletion = resolve
    })
    const initial = createComment()
    initial.replies = [
      {
        id: 'reply-1',
        content: 'A reply',
        created_at: 2,
        created_by: 'user-1',
        created_by_account: initial.created_by_account,
      },
    ]

    function Thread() {
      const [comment, setComment] = useState(initial)
      const [loading, setLoading] = useState(false)
      return (
        <CommentThread
          comment={comment}
          loading={loading}
          onClose={() => {}}
          onReply={() => {}}
          onReplyEdit={() => {}}
          onReplyDeleteDirect={async (id) => {
            setLoading(true)
            onDelete(id)
            await deletion
            setComment({ ...initial, replies: [] })
            setLoading(false)
          }}
        />
      )
    }

    renderWithAccountProfile(<Thread />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    await user.click(
      screen.getByRole('button', { name: 'workflowComments.comments.aria.replyActions' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'workflowComments.comments.actions.deleteReply' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'common.operation.delete' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.click(confirm)
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('reply-1')

    await act(async () => finishDeletion())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'workflowComments.comments.aria.replyActions' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
  })

  it('focuses the reply input when navigating to another comment', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onReply = vi.fn()

    function Comments() {
      const [comment, setComment] = useState(createComment)
      return (
        <CommentThread
          comment={comment}
          onClose={() => {}}
          onReply={onReply}
          canGoNext
          onNext={() => setComment((current) => ({ ...current, id: 'comment-2' }))}
        />
      )
    }

    renderWithAccountProfile(<Comments />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    const replyInput = screen.getByRole('textbox')
    expect(replyInput).toHaveFocus()

    await user.click(
      screen.getByRole('button', { name: 'workflowComments.comments.aria.nextComment' }),
    )
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(replyInput).toHaveFocus()
  })
})
