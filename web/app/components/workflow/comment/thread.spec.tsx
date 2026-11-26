import type { WorkflowCommentDetail } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import type { ThreadReply } from './pending-reply'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../__tests__/workflow-test-env'
import { seedMentionableUsers } from './__tests__/comment-query-data'
import { CommentThreadFixture } from './__tests__/comment-thread-fixture'

const render = (ui: ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', name: 'Alice', avatar_url: 'alice.png' },
  })
  seedMentionableUsers(queryClient, [
    { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: 'alice.png' },
    { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: 'bob.png' },
  ])
  return renderWorkflowFlowComponent(<div id="workflow-container">{ui}</div>, {
    queryClient,
  })
}

const createComment = (): WorkflowCommentDetail => ({
  id: 'comment-1',
  position_x: 120,
  position_y: 80,
  content: '@Alice original comment',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'alice.png',
  },
  created_at: 1,
  updated_at: 2,
  resolved: false,
  mentions: [],
  replies: [
    {
      id: 'reply-1',
      content: 'first reply',
      created_by: 'user-1',
      created_by_account: {
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        avatar_url: 'alice.png',
      },
      created_at: 2,
    },
  ],
})

describe('CommentThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the comment readable and its actions usable while the thread loads', async () => {
    const onResolve = vi.fn()

    render(
      <CommentThreadFixture
        comment={{ ...createComment(), replies: [] }}
        loading
        onResolve={onResolve}
        onReply={() => {}}
      />,
    )

    expect(await screen.findByText(/original comment/)).toBeVisible()
    expect(screen.queryByText('workflowComments.comments.loading')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    const resolve = screen.getByRole('button', {
      name: 'workflowComments.comments.aria.resolveComment',
    })
    expect(resolve).toBeEnabled()
    fireEvent.click(resolve)
    expect(onResolve).toHaveBeenCalledOnce()
  })

  it('marks a sending reply busy and shows a failed one with retry and delete', async () => {
    const user = userEvent.setup()
    const onReplyRetry = vi.fn()
    const onReplyDiscard = vi.fn()
    const comment = createComment()
    const author = comment.replies[0]!.created_by_account
    const unsent: ThreadReply[] = [
      {
        id: 'local-1',
        content: 'still sending',
        created_by: 'user-1',
        created_by_account: author,
        send_state: 'pending',
      },
      {
        id: 'local-2',
        content: 'did not send',
        created_by: 'user-1',
        created_by_account: author,
        send_state: 'failed',
      },
    ]

    render(
      <CommentThreadFixture
        comment={{ ...comment, replies: [...comment.replies, ...unsent] }}
        onReply={() => {}}
        onReplyRetry={onReplyRetry}
        onReplyDiscard={onReplyDiscard}
      />,
    )

    expect((await screen.findByText('still sending')).closest('[aria-busy="true"]')).not.toBeNull()
    // Unsent replies have no actions menu; only the saved reply does.
    expect(
      screen.getAllByRole('button', { name: 'workflowComments.comments.aria.replyActions' }),
    ).toHaveLength(1)
    expect(screen.getByText('workflowComments.comments.status.notSent')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(onReplyRetry).toHaveBeenCalledWith('local-2')
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    expect(onReplyDiscard).toHaveBeenCalledWith('local-2')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('keeps the edit field and its draft when saving an edit fails', async () => {
    const user = userEvent.setup()
    const onReplyEdit = vi.fn().mockRejectedValue(new Error('Request failed'))
    render(
      <CommentThreadFixture
        comment={createComment()}
        onReply={() => {}}
        onReplyEdit={onReplyEdit}
      />,
    )
    await user.click(
      await screen.findByRole('button', { name: 'workflowComments.comments.aria.replyActions' }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'workflowComments.comments.actions.editReply' }),
    )
    const editor = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.editReply',
    )
    await user.type(editor, ' edited')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(onReplyEdit).toHaveBeenCalled())
    expect(
      screen.getByPlaceholderText('workflowComments.comments.placeholder.editReply'),
    ).toHaveValue('first reply edited')
  })

  it('triggers header actions and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const onResolve = vi.fn()
    const onPrev = vi.fn()
    const onNext = vi.fn()

    render(
      <CommentThreadFixture
        comment={createComment()}
        onClose={onClose}
        onDelete={onDelete}
        onResolve={onResolve}
        onPrev={onPrev}
        onNext={onNext}
      />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.deleteComment'))
    expect(onDelete).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('workflowComments.comments.confirm.deleteThreadTitle')
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.delete' }))
    await user.click(screen.getByLabelText('workflowComments.comments.aria.resolveComment'))
    await user.click(screen.getByLabelText('workflowComments.comments.aria.previousComment'))
    await user.click(screen.getByLabelText('workflowComments.comments.aria.nextComment'))
    await user.click(screen.getByLabelText('workflowComments.comments.aria.closeComment'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps focus inside the thread when it opens while still loading', async () => {
    render(<CommentThreadFixture comment={createComment()} loading onReply={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement),
    )
  })

  it('dismisses the delete confirmation once deleting moves the thread to another comment', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    function Thread() {
      const [comment, setComment] = useState(createComment)
      return (
        <CommentThreadFixture
          comment={comment}
          onDelete={(commentId) => {
            onDelete(commentId)
            // The canvas opens the next comment after a successful delete.
            setComment((current) => ({ ...current, id: 'comment-2', content: 'Next comment' }))
          }}
        />
      )
    }

    render(<Thread />)
    await user.click(screen.getByLabelText('workflowComments.comments.aria.deleteComment'))
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.delete' }))

    expect(onDelete).toHaveBeenCalledExactlyOnceWith('comment-1')
    expect(await screen.findByText('Next comment')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('closes on an outside press', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <>
        <button type="button">Elsewhere</button>
        <CommentThreadFixture comment={createComment()} onClose={onClose} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves editing on Escape and keeps the thread open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <CommentThreadFixture
        comment={createComment()}
        onClose={onClose}
        onReply={vi.fn()}
        onCommentEdit={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.commentActions'))
    await user.click(screen.getByText('workflowComments.comments.actions.editComment'))
    const editor = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.editComment',
    )
    await waitFor(() => expect(editor).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
    expect(editor).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('workflowComments.comments.placeholder.reply'),
      ).toHaveFocus(),
    )
  })

  it('locks the edit field while its edit is being saved', async () => {
    const user = userEvent.setup()
    const comment = createComment()
    render(
      <CommentThreadFixture comment={comment} onCommentEdit={vi.fn()} savingIds={[comment.id]} />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.commentActions'))
    await user.click(screen.getByText('workflowComments.comments.actions.editComment'))
    const editor = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.editComment',
    )
    expect(editor).toHaveAttribute('readonly')
    // Mentions cannot change the draft either while it saves.
    const mentionButtons = screen.getAllByRole('button', {
      name: 'workflowAgent.nodes.agent.task.mention',
    })
    expect(mentionButtons[0]).toBeDisabled()
  })

  it('supports editing the root comment when the current user owns the thread', async () => {
    const user = userEvent.setup()
    const onCommentEdit = vi.fn()

    render(
      <CommentThreadFixture
        comment={createComment()}
        onClose={vi.fn()}
        onCommentEdit={onCommentEdit}
      />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.commentActions'))
    await user.click(screen.getByText('workflowComments.comments.actions.editComment'))
    const editor = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.editComment',
    )
    await waitFor(() => expect(editor).toHaveFocus())
    await user.clear(editor)
    await user.type(editor, 'Updated root comment')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(onCommentEdit).toHaveBeenCalledWith('Updated root comment', [])
    })
  })

  it('submits reply and updates preview hovering state on mouse enter/leave', async () => {
    const user = userEvent.setup()
    const onReply = vi.fn()
    const { store } = render(
      <CommentThreadFixture comment={createComment()} onClose={vi.fn()} onReply={onReply} />,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.mouseEnter(dialog)
    expect(store.getState().isCommentPreviewHovering).toBe(true)
    fireEvent.mouseLeave(dialog)
    expect(store.getState().isCommentPreviewHovering).toBe(false)

    const input = screen.getByPlaceholderText('workflowComments.comments.placeholder.reply')
    await user.type(input, '@Bo')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(input).toHaveValue('@Bob '))
    await user.type(input, 'please review')
    await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('@Bob please review', ['user-2']))
  })

  it('supports editing and direct deleting an existing reply', async () => {
    const user = userEvent.setup()
    const onReplyEdit = vi.fn()
    const onReplyDelete = vi.fn()

    render(
      <CommentThreadFixture
        comment={createComment()}
        onClose={vi.fn()}
        onReplyEdit={onReplyEdit}
        onReplyDelete={onReplyDelete}
      />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.replyActions'))
    await user.click(await screen.findByText('workflowComments.comments.actions.editReply'))
    const editor = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.editReply',
    )
    await waitFor(() => expect(editor).toHaveFocus())
    await user.clear(editor)
    await user.type(editor, 'Updated reply')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(onReplyEdit).toHaveBeenCalledWith('reply-1', 'Updated reply', [])
    })

    await waitFor(() => {
      expect(
        screen.getByLabelText('workflowComments.comments.aria.replyActions'),
      ).toBeInTheDocument()
    })
    await user.click(screen.getByLabelText('workflowComments.comments.aria.replyActions'))
    await user.click(await screen.findByText('workflowComments.comments.actions.deleteReply'))
    const confirmation = await screen.findByRole('dialog', {
      name: 'workflowComments.comments.confirm.deleteReplyTitle',
    })
    expect(onReplyDelete).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.delete' }))

    expect(onReplyDelete).toHaveBeenCalledWith('reply-1')
  })
})
