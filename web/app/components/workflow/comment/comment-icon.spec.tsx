import type { WorkflowCommentList } from '@/service/workflow-comment'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentIcon } from './comment-icon'

type Position = { x: number, y: number }

let mockUserId = 'user-1'

const mockFlowToScreenPosition = vi.fn((position: Position) => position)
const mockScreenToFlowPosition = vi.fn((position: Position) => position)

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    flowToScreenPosition: mockFlowToScreenPosition,
    screenToFlowPosition: mockScreenToFlowPosition,
  }),
  useViewport: () => ({
    x: 0,
    y: 0,
    zoom: 1,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      id: mockUserId,
      name: 'User',
      avatar_url: 'avatar',
    },
  }),
}))

vi.mock('@/app/components/base/user-avatar-list', () => ({
  UserAvatarList: ({ users }: { users: Array<{ id: string }> }) => (
    <div data-testid="avatar-list">{users.map(user => user.id).join(',')}</div>
  ),
}))

vi.mock('./comment-preview', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" data-testid="comment-preview" onClick={onClick}>
      Preview
    </button>
  ),
}))

const createComment = (overrides: Partial<WorkflowCommentList> = {}): WorkflowCommentList => ({
  id: 'comment-1',
  position_x: 0,
  position_y: 0,
  content: 'Hello',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  created_at: 1,
  updated_at: 2,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
  ...overrides,
})

describe('CommentIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserId = 'user-1'
  })

  it('toggles preview on hover when inactive', () => {
    const comment = createComment()
    const { container } = render(
      <CommentIcon comment={comment} onClick={vi.fn()} isActive={false} />,
    )
    const marker = container.querySelector('[data-role="comment-marker"]') as HTMLElement
    const hoverTarget = marker.firstElementChild as HTMLElement

    fireEvent.mouseEnter(hoverTarget)
    expect(screen.getByTestId('comment-preview')).toBeInTheDocument()

    fireEvent.mouseLeave(hoverTarget)
    expect(screen.queryByTestId('comment-preview')).not.toBeInTheDocument()
  })

  it('calls onPositionUpdate after dragging by author', () => {
    const comment = createComment({ position_x: 0, position_y: 0 })
    const onClick = vi.fn()
    const onPositionUpdate = vi.fn()
    const { container } = render(
      <CommentIcon
        comment={comment}
        onClick={onClick}
        onPositionUpdate={onPositionUpdate}
      />,
    )
    const marker = container.querySelector('[data-role="comment-marker"]') as HTMLElement

    fireEvent.pointerDown(marker, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(marker, {
      pointerId: 1,
      clientX: 110,
      clientY: 110,
    })
    fireEvent.pointerUp(marker, {
      pointerId: 1,
      clientX: 110,
      clientY: 110,
    })

    expect(mockScreenToFlowPosition).toHaveBeenCalledWith({ x: 10, y: 10 })
    expect(onPositionUpdate).toHaveBeenCalledWith({ x: 10, y: 10 })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('calls onClick for non-author clicks', () => {
    mockUserId = 'user-2'
    const comment = createComment()
    const onClick = vi.fn()
    const { container } = render(
      <CommentIcon comment={comment} onClick={onClick} isActive={false} />,
    )
    const marker = container.querySelector('[data-role="comment-marker"]') as HTMLElement

    fireEvent.pointerDown(marker, {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 60,
    })
    fireEvent.pointerUp(marker, {
      pointerId: 1,
      clientX: 50,
      clientY: 60,
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
