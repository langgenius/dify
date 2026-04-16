import type { WorkflowCommentList } from '@/service/workflow-comment'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommentPreview from './comment-preview'

type UserProfile = WorkflowCommentList['created_by_account']

const mockSetHovering = vi.fn()
let capturedUsers: UserProfile[] = []

vi.mock('@/app/components/base/user-avatar-list', () => ({
  UserAvatarList: ({ users }: { users: UserProfile[] }) => {
    capturedUsers = users
    return <div data-testid="avatar-list">{users.map(user => user.id).join(',')}</div>
  },
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (value: number) => `time:${value}`,
  }),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: { setCommentPreviewHovering: (value: boolean) => void }) => unknown) =>
    selector({ setCommentPreviewHovering: mockSetHovering }),
}))

const createComment = (overrides: Partial<WorkflowCommentList> = {}): WorkflowCommentList => {
  const author = { id: 'user-1', name: 'Alice', email: 'alice@example.com' }
  const participant = { id: 'user-2', name: 'Bob', email: 'bob@example.com' }

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
    participants: [author, participant],
    ...overrides,
  }
}

describe('CommentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedUsers = []
  })

  it('orders participants with author first and formats time', () => {
    const comment = createComment()

    render(<CommentPreview comment={comment} />)

    expect(capturedUsers.map(user => user.id)).toEqual(['user-1', 'user-2'])
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('time:10000')).toBeInTheDocument()
  })

  it('updates hover state on enter and leave', () => {
    const comment = createComment()
    const { container } = render(<CommentPreview comment={comment} />)
    const root = container.firstElementChild as HTMLElement

    fireEvent.mouseEnter(root)
    fireEvent.mouseLeave(root)

    expect(mockSetHovering).toHaveBeenCalledWith(true)
    expect(mockSetHovering).toHaveBeenCalledWith(false)
  })

  it('clears hover state on unmount', () => {
    const comment = createComment()
    const { unmount } = render(<CommentPreview comment={comment} />)

    unmount()

    expect(mockSetHovering).toHaveBeenCalledWith(false)
  })
})
