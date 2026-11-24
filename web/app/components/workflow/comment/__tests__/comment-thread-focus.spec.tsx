import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { UserProfile } from '../types'
import {
  createPopoverHandle,
  Popover,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { CommentIcon } from '../comment-icon'
import { CommentInput } from '../comment-input'
import { getCommentMarkerId } from '../marker-id'
import { commentThreadPlacement } from '../popup-placement'
import { CommentThread } from '../thread'
import { seedMentionableUsers } from './comment-query-data'
import { CommentThreadFixture } from './comment-thread-fixture'

let mentionableUsers: UserProfile[] = []
const renderWithAccountProfile = (ui: Parameters<typeof renderWorkflowFlowComponent>[0]) => {
  const { queryClient } = createConsoleQueryWrapper({ accountProfile: { id: 'user-1' } })
  seedMentionableUsers(queryClient, mentionableUsers)
  return renderWorkflowFlowComponent(ui, {
    queryClient,
  })
}

const createComment = (): WorkflowCommentDetail & WorkflowCommentBasic => ({
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
    mentionableUsers = []
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
      mentionableUsers = [{ id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null }]
      renderWithAccountProfile(
        kind === 'draft' ? (
          <CommentInput position={{ x: 0, y: 0 }} onSubmit={() => {}} onCancel={onClose} />
        ) : (
          <CommentThreadFixture comment={createComment()} onClose={onClose} onReply={() => {}} />
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
      const [handle] = useState(() => createPopoverHandle())
      return (
        <div id="workflow-container">
          <CommentIcon
            comment={comment}
            threadHandle={handle}
            isActive={opened}
            onPositionUpdate={(_commentId, position) => {
              onPositionUpdate(position)
              setComment((current) => ({
                ...current,
                position_x: position.x,
                position_y: position.y,
              }))
            }}
          />
          <Popover
            handle={handle}
            open={opened}
            triggerId={opened ? getCommentMarkerId(comment.id) : null}
            onOpenChange={setOpened}
          >
            <PopoverPortal>
              <PopoverPositioner {...commentThreadPlacement}>
                {opened && <CommentThread comment={comment} onReply={() => {}} />}
              </PopoverPositioner>
            </PopoverPortal>
          </Popover>
        </div>
      )
    }

    renderWithAccountProfile(<Comment />)
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
    act(() => marker.focus())
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

  it('confirms reply deletion inside the reply menu, starting on cancel', async () => {
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
      <CommentThreadFixture
        comment={comment}
        onClose={onClose}
        onReply={() => {}}
        onReplyEdit={() => {}}
        onReplyDelete={onDelete}
      />,
    )
    await act(() => vi.advanceTimersByTimeAsync(100))
    const trigger = screen.getByRole('button', {
      name: 'workflowComments.comments.aria.replyActions',
    })
    await user.click(trigger)
    await user.click(
      screen.getByRole('menuitem', { name: 'workflowComments.comments.actions.deleteReply' }),
    )
    const confirmation = await screen.findByRole('dialog', {
      name: 'workflowComments.comments.confirm.deleteReplyTitle',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // The safe choice starts focused, so a second Enter cannot delete.
    await waitFor(() =>
      expect(
        within(confirmation).getByRole('button', { name: 'common.operation.cancel' }),
      ).toHaveFocus(),
    )
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', {
          name: 'workflowComments.comments.confirm.deleteReplyTitle',
        }),
      ).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onDelete).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(trigger)
    await user.click(
      screen.getByRole('menuitem', { name: 'workflowComments.comments.actions.deleteReply' }),
    )
    await user.click(
      within(
        await screen.findByRole('dialog', {
          name: 'workflowComments.comments.confirm.deleteReplyTitle',
        }),
      ).getByRole('button', { name: 'common.operation.delete' }),
    )
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('reply-1')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('focuses the reply input once a deleted reply is gone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
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
      // Like the canvas, the thread shows its loading state while the reply is deleted.
      const [loading, setLoading] = useState(false)
      return (
        <CommentThreadFixture
          comment={comment}
          loading={loading}
          onReply={() => {}}
          onReplyEdit={() => {}}
          onReplyDelete={async () => {
            setLoading(true)
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
    await user.click(
      within(
        await screen.findByRole('dialog', {
          name: 'workflowComments.comments.confirm.deleteReplyTitle',
        }),
      ).getByRole('button', { name: 'common.operation.delete' }),
    )
    await act(async () => finishDeletion())

    expect(screen.queryByText('A reply')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
  })

  it('starts a fresh reply draft on navigation and keeps focus on the navigation button', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    function Comments() {
      const [comment, setComment] = useState(createComment)
      return (
        <CommentThreadFixture
          comment={comment}
          onReply={() => {}}
          onNext={() => setComment((current) => ({ ...current, id: 'comment-2' }))}
        />
      )
    }

    renderWithAccountProfile(<Comments />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByRole('textbox')).toHaveFocus()
    await user.type(screen.getByRole('textbox'), 'Unsent draft')

    const next = screen.getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
    await user.click(next)

    expect(next).toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('does not pull focus to a newer comment when an earlier reply finishes sending', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let finishReply = () => {}

    function Comments() {
      const [comment, setComment] = useState(createComment)
      return (
        <CommentThreadFixture
          comment={comment}
          onReply={() => new Promise<void>((resolve) => (finishReply = resolve))}
          onNext={() => setComment((current) => ({ ...current, id: 'comment-2' }))}
        />
      )
    }

    renderWithAccountProfile(<Comments />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    await user.type(screen.getByRole('textbox'), 'Sent from the first comment{Enter}')
    const next = screen.getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
    await user.click(next)
    expect(next).toHaveFocus()

    await act(async () => {
      finishReply()
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(next).toHaveFocus()
  })

  it('keeps the mentions of a reply drafted while the previous one is still sending', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mentionableUsers = [{ id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null }]
    const sent: Array<[string, string[]]> = []
    let finishFirst = () => {}
    renderWithAccountProfile(
      <CommentThreadFixture
        comment={createComment()}
        onReply={(content, ids) => {
          sent.push([content, ids ?? []])
          if (sent.length === 1) return new Promise<void>((resolve) => (finishFirst = resolve))
        }}
      />,
    )
    await act(() => vi.advanceTimersByTimeAsync(100))
    const reply = screen.getByRole('textbox')
    await user.type(reply, 'First{Enter}')
    await user.type(reply, 'Second @Bo')
    await user.click(await screen.findByText('bob@example.com'))
    await act(async () => finishFirst())
    await user.type(reply, '{Enter}')

    expect(sent).toEqual([
      ['First', []],
      ['Second @Bob', ['user-2']],
    ])
  })
})
