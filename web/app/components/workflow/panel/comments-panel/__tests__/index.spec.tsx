import type { WorkflowCommentList } from '@/service/workflow-comment'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CommentsPanel from '../index'

const mockHandleCommentIconClick = vi.hoisted(() => vi.fn())
const mockLoadComments = vi.hoisted(() => vi.fn())
const mockSetActiveCommentId = vi.hoisted(() => vi.fn())
const mockSetControlMode = vi.hoisted(() => vi.fn())
const mockSetShowResolvedComments = vi.hoisted(() => vi.fn())
const mockResolveWorkflowComment = vi.hoisted(() => vi.fn())
const mockEmitCommentsUpdate = vi.hoisted(() => vi.fn())

const commentFixtures: WorkflowCommentList[] = [
  {
    id: 'c-1',
    position_x: 10,
    position_y: 20,
    created_by: 'user-1',
    created_by_account: { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: '' },
    content: 'my open thread',
    created_at: 1,
    updated_at: 2,
    resolved: false,
    mention_count: 0,
    reply_count: 2,
    participants: [],
  },
  {
    id: 'c-2',
    position_x: 30,
    position_y: 40,
    created_by: 'user-2',
    created_by_account: { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: '' },
    content: 'others resolved thread',
    created_at: 3,
    updated_at: 4,
    resolved: true,
    mention_count: 0,
    reply_count: 0,
    participants: [],
  },
]

type WorkflowStoreSelectionState = {
  activeCommentId: string | null
  setActiveCommentId: (value: string | null) => void
  setControlMode: (value: unknown) => void
  showResolvedComments: boolean
  setShowResolvedComments: (value: boolean) => void
}

const storeState = {
  activeCommentId: null as string | null,
  showResolvedComments: true,
}

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
    userProfile: { id: 'user-1' },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: WorkflowStoreSelectionState) => unknown) => selector({
    activeCommentId: storeState.activeCommentId,
    setActiveCommentId: (...args: unknown[]) => mockSetActiveCommentId(...args),
    setControlMode: (...args: unknown[]) => mockSetControlMode(...args),
    showResolvedComments: storeState.showResolvedComments,
    setShowResolvedComments: (...args: unknown[]) => mockSetShowResolvedComments(...args),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => ({
    comments: commentFixtures,
    loading: false,
    loadComments: (...args: unknown[]) => mockLoadComments(...args),
    handleCommentIconClick: (...args: unknown[]) => mockHandleCommentIconClick(...args),
  }),
}))

vi.mock('@/service/workflow-comment', () => ({
  resolveWorkflowComment: (...args: unknown[]) => mockResolveWorkflowComment(...args),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitCommentsUpdate: (...args: unknown[]) => mockEmitCommentsUpdate(...args),
  },
}))

vi.mock('@/app/components/base/user-avatar-list', () => ({
  UserAvatarList: () => <div data-testid="user-avatar-list" />,
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({ checked, onCheckedChange }: { checked: boolean, onCheckedChange: (value: boolean) => void }) => (
    <button type="button" data-testid="show-resolved-switch" onClick={() => onCheckedChange(!checked)}>
      toggle
    </button>
  ),
}))

describe('CommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.activeCommentId = null
    storeState.showResolvedComments = true
    mockResolveWorkflowComment.mockResolvedValue({})
    mockLoadComments.mockResolvedValue(undefined)
  })

  it('filters comments and selects a thread', () => {
    render(<CommentsPanel />)

    expect(screen.getByText('my open thread')).toBeInTheDocument()
    expect(screen.getByText('others resolved thread')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('workflow.comments.aria.filterComments'))
    fireEvent.click(screen.getByText('workflow.comments.filter.onlyYourThreads'))
    expect(screen.queryByText('others resolved thread')).not.toBeInTheDocument()
    expect(screen.getByText('my open thread')).toBeInTheDocument()

    fireEvent.click(screen.getByText('my open thread'))
    expect(mockHandleCommentIconClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }))
  })

  it('resolves a comment and syncs list refresh', async () => {
    const { container } = render(<CommentsPanel />)
    const resolveIcons = container.querySelectorAll('.h-4.w-4.cursor-pointer.text-text-tertiary')
    expect(resolveIcons.length).toBeGreaterThan(0)

    fireEvent.click(resolveIcons[0]!)

    await waitFor(() => {
      expect(mockResolveWorkflowComment).toHaveBeenCalledWith('app-1', 'c-1')
      expect(mockEmitCommentsUpdate).toHaveBeenCalledWith('app-1')
      expect(mockLoadComments).toHaveBeenCalled()
      expect(mockSetActiveCommentId).toHaveBeenCalledWith('c-1')
    })
  })

  it('toggles show-resolved state from filter panel switch', () => {
    render(<CommentsPanel />)

    fireEvent.click(screen.getByLabelText('workflow.comments.aria.filterComments'))
    fireEvent.click(screen.getByTestId('show-resolved-switch'))

    expect(mockSetShowResolvedComments).toHaveBeenCalledWith(false)
  })
})
