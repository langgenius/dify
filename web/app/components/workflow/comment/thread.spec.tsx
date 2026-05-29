import type { WorkflowCommentDetail } from '@/contract/console/workflow-comment'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommentThread } from './thread'

const mockSetCommentPreviewHovering = vi.hoisted(() => vi.fn())
const mockFlowToScreenPosition = vi.hoisted(() => vi.fn(({ x, y }: { x: number, y: number }) => ({ x, y })))

const storeState = vi.hoisted(() => ({
  mentionableUsersCache: {
    'app-1': [
      { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: 'alice.png' },
      { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: 'bob.png' },
    ],
  } as Record<string, Array<{ id: string, name: string, email: string, avatar_url: string }>>,
  setCommentPreviewHovering: (...args: unknown[]) => mockSetCommentPreviewHovering(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'just now',
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      id: 'user-1',
      name: 'Alice',
      avatar_url: 'alice.png',
    },
  }),
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    flowToScreenPosition: mockFlowToScreenPosition,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

vi.mock('@/app/components/workflow/collaboration/utils/user-color', () => ({
  getUserColor: () => '#22c55e',
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/inline-delete-confirm', () => ({
  default: ({ onConfirm }: { onConfirm: () => void }) => (
    <button type="button" data-testid="confirm-delete-reply" onClick={onConfirm}>
      confirm delete
    </button>
  ),
}))

vi.mock('@langgenius/dify-ui/avatar', () => ({
  Avatar: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
  AvatarRoot: ({ children }: { children: React.ReactNode }) => <div data-testid="avatar-root">{children}</div>,
  AvatarImage: ({ alt }: { alt: string }) => <div data-testid="avatar-image">{alt}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <div data-testid="avatar-fallback">{children}</div>,
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
    ...props
  }: React.ComponentProps<'button'> & { children?: React.ReactNode, render?: React.ReactNode }) => {
    if (render)
      return <>{render}</>

    return <button type="button" {...props}>{children}</button>
  },
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./mention-input', () => ({
  MentionInput: ({
    placeholder,
    value,
    onSubmit,
    onCancel,
  }: {
    placeholder?: string
    value: string
    onSubmit: (content: string, mentionedUserIds: string[]) => void
    onCancel?: () => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onSubmit(value || `content:${placeholder ?? 'default'}`, ['user-2'])}
      >
        {`submit-${placeholder ?? 'default'}`}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          {`cancel-${placeholder ?? 'default'}`}
        </button>
      )}
    </div>
  ),
}))

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
  replies: [{
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
  }],
})

describe('CommentThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    const workflowContainer = document.createElement('div')
    workflowContainer.id = 'workflow-container'
    document.body.appendChild(workflowContainer)
  })

  it('triggers header actions and closes on Escape', () => {
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

    fireEvent.click(screen.getByLabelText('workflow.comments.aria.deleteComment'))
    fireEvent.click(screen.getByLabelText('workflow.comments.aria.resolveComment'))
    fireEvent.click(screen.getByLabelText('workflow.comments.aria.previousComment'))
    fireEvent.click(screen.getByLabelText('workflow.comments.aria.nextComment'))
    fireEvent.click(screen.getByLabelText('workflow.comments.aria.closeComment'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not nest header action buttons inside tooltip trigger buttons', () => {
    const { container } = render(
      <CommentThread
        comment={createComment()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onResolve={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canGoPrev
        canGoNext
      />,
    )

    expect(container.querySelector('button button')).toBeNull()
  })

  it('supports editing the root comment when the current user owns the thread', async () => {
    const onCommentEdit = vi.fn()

    render(
      <CommentThread
        comment={createComment()}
        onClose={vi.fn()}
        onCommentEdit={onCommentEdit}
      />,
    )

    fireEvent.click(screen.getByLabelText('workflow.comments.aria.commentActions'))
    fireEvent.click(screen.getByText('workflow.comments.actions.editComment'))
    fireEvent.click(screen.getByText('submit-workflow.comments.placeholder.editComment'))

    await waitFor(() => {
      expect(onCommentEdit).toHaveBeenCalledWith('@Alice original comment', ['user-2'])
    })
  })

  it('submits reply and updates preview hovering state on mouse enter/leave', async () => {
    const onReply = vi.fn()
    const { container } = render(
      <CommentThread
        comment={createComment()}
        onClose={vi.fn()}
        onReply={onReply}
      />,
    )

    fireEvent.mouseEnter(container.firstElementChild as Element)
    fireEvent.mouseLeave(container.firstElementChild as Element)

    expect(mockSetCommentPreviewHovering).toHaveBeenNthCalledWith(1, true)
    expect(mockSetCommentPreviewHovering).toHaveBeenNthCalledWith(2, false)

    fireEvent.click(screen.getByText('submit-workflow.comments.placeholder.reply'))

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith('content:workflow.comments.placeholder.reply', ['user-2'])
    })
  })

  it('supports editing and direct deleting an existing reply', async () => {
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

    fireEvent.click(screen.getByText('workflow.comments.actions.editReply'))
    fireEvent.click(screen.getByText('submit-workflow.comments.placeholder.editReply'))

    await waitFor(() => {
      expect(onReplyEdit).toHaveBeenCalledWith('reply-1', 'first reply', ['user-2'])
    })

    await waitFor(() => {
      expect(screen.getByText('workflow.comments.actions.deleteReply')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('workflow.comments.actions.deleteReply'))
    fireEvent.click(screen.getByTestId('confirm-delete-reply'))

    expect(onReplyDeleteDirect).toHaveBeenCalledWith('reply-1')
  })
})
