import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowComponent as render } from '../__tests__/workflow-test-env'
import CommentPreview from './comment-preview'

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (value: number) => `time:${value}`,
  }),
}))

const createComment = (overrides: Partial<WorkflowCommentBasic> = {}): WorkflowCommentBasic => {
  const author = { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: null }
  const participant = { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null }

  return {
    id: 'comment-1',
    position_x: 0,
    position_y: 0,
    content: 'Hello',
    created_by: author.id,
    created_by_account: author,
    created_at: 1,
    updated_at: 10,
    resolved: false,
    mention_count: 0,
    reply_count: 0,
    participants: [participant, author],
    ...overrides,
  }
}

describe('CommentPreview', () => {
  it('orders participants with author first and formats time', () => {
    const comment = createComment()

    render(<CommentPreview comment={comment} />)

    expect(screen.getAllByRole('img').map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
      'Alice',
      'Bob',
    ])
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('time:10000')).toBeInTheDocument()
  })

  it('tracks hovering and releases the preview on leave or unmount', async () => {
    const user = userEvent.setup()
    const { store, unmount } = render(<CommentPreview comment={createComment()} />)
    const content = screen.getByText('Hello')
    await user.hover(content)
    expect(store.getState().isCommentPreviewHovering).toBe(true)
    await user.unhover(content)
    expect(store.getState().isCommentPreviewHovering).toBe(false)
    await user.hover(content)
    expect(store.getState().isCommentPreviewHovering).toBe(true)
    unmount()
    expect(store.getState().isCommentPreviewHovering).toBe(false)
  })
})
