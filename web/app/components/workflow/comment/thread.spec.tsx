import type { WorkflowCommentDetail } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../__tests__/workflow-test-env'
import { CommentThread } from './thread'

const render = (ui: ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', name: 'Alice', avatar_url: 'alice.png' },
  })
  return renderWorkflowFlowComponent(<div id="workflow-container">{ui}</div>, {
    queryClient,
    initialStoreState: {
      mentionableUsersCache: {
        'app-1': [
          { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: 'alice.png' },
          { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: 'bob.png' },
        ],
      },
    },
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

  it('triggers header actions and closes on Escape', async () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const onResolve = vi.fn()
    const onPrev = vi.fn()
    const onNext = vi.fn()

    render(
      <CommentThread
        comment={createComment()}
        onClose={onClose}
        onDelete={onDelete}
        onResolve={onResolve}
        onPrev={onPrev}
        onNext={onNext}
        canGoPrev
        canGoNext
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.deleteComment'))
    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.resolveComment'))
    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.previousComment'))
    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.nextComment'))
    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.closeComment'))

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('supports editing the root comment when the current user owns the thread', async () => {
    const user = userEvent.setup()
    const onCommentEdit = vi.fn()

    render(
      <CommentThread comment={createComment()} onClose={vi.fn()} onCommentEdit={onCommentEdit} />,
    )

    await userEvent
      .setup()
      .click(screen.getByLabelText('workflowComments.comments.aria.commentActions'))
    await userEvent.setup().click(screen.getByText('workflowComments.comments.actions.editComment'))
    const editor = screen.getByPlaceholderText('workflowComments.comments.placeholder.editComment')
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
      <CommentThread comment={createComment()} onClose={vi.fn()} onReply={onReply} />,
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
    const onReplyDeleteDirect = vi.fn()

    render(
      <CommentThread
        comment={createComment()}
        onClose={vi.fn()}
        onReplyEdit={onReplyEdit}
        onReplyDeleteDirect={onReplyDeleteDirect}
      />,
    )

    await user.click(screen.getByLabelText('workflowComments.comments.aria.replyActions'))
    await user.click(await screen.findByText('workflowComments.comments.actions.editReply'))
    const editor = screen.getByPlaceholderText('workflowComments.comments.placeholder.editReply')
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
    await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))

    expect(onReplyDeleteDirect).toHaveBeenCalledWith('reply-1')
  })
})
