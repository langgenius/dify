import type { WorkflowCommentDetail, WorkflowCommentList } from '@/contract/console/workflow-comment'
import { act, waitFor } from '@testing-library/react'
import { createTestQueryClient, seedSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import { useWorkflowComment } from '../use-workflow-comment'

const mockScreenToFlowPosition = vi.hoisted(() => vi.fn(({ x, y }: { x: number, y: number }) => ({ x: x - 90, y: y - 180 })))
const mockSetCenter = vi.hoisted(() => vi.fn())
const mockGetNodes = vi.hoisted(() => vi.fn(() => []))

const mockCreateWorkflowComment = vi.hoisted(() => vi.fn())
const mockCreateWorkflowCommentReply = vi.hoisted(() => vi.fn())
const mockDeleteWorkflowComment = vi.hoisted(() => vi.fn())
const mockDeleteWorkflowCommentReply = vi.hoisted(() => vi.fn())
const mockFetchWorkflowComment = vi.hoisted(() => vi.fn())
const mockFetchWorkflowComments = vi.hoisted(() => vi.fn())
const mockResolveWorkflowComment = vi.hoisted(() => vi.fn())
const mockUpdateWorkflowComment = vi.hoisted(() => vi.fn())
const mockUpdateWorkflowCommentReply = vi.hoisted(() => vi.fn())

const mockEmitCommentsUpdate = vi.hoisted(() => vi.fn())
const mockUnsubscribeCommentsUpdate = vi.hoisted(() => vi.fn())
const commentsUpdateState = vi.hoisted(() => ({
  handler: undefined as undefined | (() => void),
}))

const globalFeatureState = vi.hoisted(() => ({
  enableCollaboration: true,
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    screenToFlowPosition: mockScreenToFlowPosition,
    setCenter: mockSetCenter,
    getNodes: mockGetNodes,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
      avatar_url: 'alice.png',
    },
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: () => ({
      enable_collaboration_mode: globalFeatureState.enableCollaboration,
    }),
    workflowComments: {
      create: (...args: unknown[]) => mockCreateWorkflowComment(...args),
      delete: (...args: unknown[]) => mockDeleteWorkflowComment(...args),
      detail: (...args: unknown[]) => mockFetchWorkflowComment(...args),
      list: (...args: unknown[]) => mockFetchWorkflowComments(...args),
      resolve: (...args: unknown[]) => mockResolveWorkflowComment(...args),
      update: (...args: unknown[]) => mockUpdateWorkflowComment(...args),
      replies: {
        create: (...args: unknown[]) => mockCreateWorkflowCommentReply(...args),
        delete: (...args: unknown[]) => mockDeleteWorkflowCommentReply(...args),
        update: (...args: unknown[]) => mockUpdateWorkflowCommentReply(...args),
      },
    },
  },
  consoleQuery: {
    systemFeatures: {
      queryKey: () => ['console', 'systemFeatures'],
    },
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitCommentsUpdate: (...args: unknown[]) => mockEmitCommentsUpdate(...args),
    onCommentsUpdate: (handler: () => void) => {
      commentsUpdateState.handler = handler
      return mockUnsubscribeCommentsUpdate
    },
  },
}))

const baseComment = (): WorkflowCommentList => ({
  id: 'comment-1',
  position_x: 10,
  position_y: 20,
  content: 'hello',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'alice.png',
  },
  created_at: 100,
  updated_at: 100,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
})

const baseCommentDetail = (): WorkflowCommentDetail => ({
  id: 'comment-1',
  position_x: 10,
  position_y: 20,
  content: 'hello',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'alice.png',
  },
  created_at: 100,
  updated_at: 100,
  resolved: false,
  mentions: [],
  replies: [],
})

const createSeededQueryClient = () => {
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient, {
    enable_collaboration_mode: globalFeatureState.enableCollaboration,
  })
  return queryClient
}

describe('useWorkflowComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commentsUpdateState.handler = undefined
    globalFeatureState.enableCollaboration = true

    mockFetchWorkflowComments.mockResolvedValue({ data: [] })
    mockFetchWorkflowComment.mockResolvedValue(baseCommentDetail())
    mockCreateWorkflowComment.mockResolvedValue({
      id: 'comment-2',
      created_at: 1700000000,
    })
    mockUpdateWorkflowComment.mockResolvedValue({})
  })

  it('loads comment list on mount when collaboration is enabled', async () => {
    const comment = baseComment()
    mockFetchWorkflowComments.mockResolvedValue({ data: [comment] })

    const { store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
    })

    await waitFor(() => {
      expect(mockFetchWorkflowComments).toHaveBeenCalledWith({
        params: { appId: 'app-1' },
      })
    })

    expect(store.getState().comments).toEqual([comment])
    expect(store.getState().commentsLoading).toBe(false)
  })

  it('does not load comment list when collaboration is disabled', async () => {
    globalFeatureState.enableCollaboration = false

    renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
    })

    await Promise.resolve()

    expect(mockFetchWorkflowComments).not.toHaveBeenCalled()
  })

  it('creates a comment, updates local cache, and emits collaboration sync', async () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 10, elementY: 20 },
        isCommentQuickAdd: true,
        mentionableUsersCache: {
          'app-1': [{
            id: 'user-2',
            name: 'Bob',
            email: 'bob@example.com',
            avatar_url: 'bob.png',
          }],
        },
      },
    })

    await act(async () => {
      await result.current.handleCommentSubmit('new message', ['user-2'])
    })

    expect(mockCreateWorkflowComment).toHaveBeenCalledWith({
      params: { appId: 'app-1' },
      body: {
        position_x: 10,
        position_y: 20,
        content: 'new message',
        mentioned_user_ids: ['user-2'],
      },
    })
    expect(mockEmitCommentsUpdate).toHaveBeenCalledWith('app-1')

    const comments = store.getState().comments
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      id: 'comment-2',
      content: 'new message',
      position_x: 10,
      position_y: 20,
      mention_count: 1,
      reply_count: 0,
    })
    expect(comments[0]?.participants.map(p => p.id)).toEqual(['user-1', 'user-2'])
    expect(store.getState().commentDetailCache['comment-2']).toMatchObject({
      content: 'new message',
      position_x: 10,
      position_y: 20,
    })
    expect(store.getState().pendingComment).toBeNull()
    expect(store.getState().isCommentQuickAdd).toBe(false)
  })

  it('normalizes numeric string timestamps when creating a comment', async () => {
    mockCreateWorkflowComment.mockResolvedValue({
      id: 'comment-string-time',
      created_at: '1700001234',
    })

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 10, elementY: 20 },
        isCommentQuickAdd: true,
      },
    })

    await act(async () => {
      await result.current.handleCommentSubmit('new message')
    })

    expect(store.getState().comments[0]).toMatchObject({
      id: 'comment-string-time',
      created_at: 1700001234,
      updated_at: 1700001234,
    })
  })

  it('normalizes ISO timestamps and keeps unresolved mentions as null', async () => {
    const createdAt = '2024-01-02T03:04:05.000Z'
    mockCreateWorkflowComment.mockResolvedValue({
      id: 'comment-date-time',
      created_at: createdAt,
    })

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 10, elementY: 20 },
        isCommentQuickAdd: true,
        mentionableUsersCache: {
          'app-1': [{
            id: 'user-2',
            name: 'Bob',
            email: 'bob@example.com',
            avatar_url: 'bob.png',
          }],
        },
      },
    })

    await act(async () => {
      await result.current.handleCommentSubmit('new message', ['missing-user'])
    })

    const expectedCreatedAt = Math.floor(Date.parse(createdAt) / 1000)
    expect(store.getState().comments[0]).toMatchObject({
      id: 'comment-date-time',
      created_at: expectedCreatedAt,
      updated_at: expectedCreatedAt,
      participants: [{
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        avatar_url: 'alice.png',
      }],
    })
    expect(store.getState().commentDetailCache['comment-date-time']?.mentions).toEqual([{
      mentioned_user_id: 'missing-user',
      mentioned_user_account: null,
      reply_id: null,
    }])
  })

  it('rolls back optimistic position update when API update fails', async () => {
    const comment = baseComment()
    const commentDetail = baseCommentDetail()
    mockUpdateWorkflowComment.mockRejectedValue(new Error('update failed'))

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [comment],
        activeCommentId: comment.id,
        activeCommentDetail: commentDetail,
        commentDetailCache: {
          [comment.id]: commentDetail,
        },
      },
    })

    await act(async () => {
      await result.current.handleCommentPositionUpdate(comment.id, { x: 300, y: 400 })
    })

    expect(mockUpdateWorkflowComment).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: comment.id },
      body: {
        content: 'hello',
        position_x: 300,
        position_y: 400,
      },
    })
    expect(mockEmitCommentsUpdate).not.toHaveBeenCalled()
    expect(store.getState().comments[0]).toMatchObject({
      position_x: 10,
      position_y: 20,
    })
    expect(store.getState().commentDetailCache[comment.id]).toMatchObject({
      position_x: 10,
      position_y: 20,
    })
  })

  it('refreshes comments and active detail when collaboration update event arrives', async () => {
    const comment = baseComment()
    const detail = {
      ...baseCommentDetail(),
      content: 'updated by another user',
    }
    mockFetchWorkflowComments.mockResolvedValue({ data: [comment] })
    mockFetchWorkflowComment.mockResolvedValue(detail)

    const { unmount } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        activeCommentId: comment.id,
      },
    })

    await waitFor(() => {
      expect(commentsUpdateState.handler).toBeTypeOf('function')
    })

    await act(async () => {
      commentsUpdateState.handler?.()
    })

    await waitFor(() => {
      expect(mockFetchWorkflowComment).toHaveBeenCalledWith({
        params: { appId: 'app-1', commentId: comment.id },
      })
    })
    expect(mockFetchWorkflowComments).toHaveBeenCalledTimes(2)

    unmount()
    expect(mockUnsubscribeCommentsUpdate).toHaveBeenCalledTimes(1)
  })

  it('focuses comment thread, loads detail, and updates navigation/create/close states', async () => {
    const commentA = baseComment()
    const commentB: WorkflowCommentList = {
      ...baseComment(),
      id: 'comment-2',
      content: 'second',
      position_x: 50,
      position_y: 80,
    }
    mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected: true } }] as never)
    mockFetchWorkflowComment.mockResolvedValue({
      ...baseCommentDetail(),
      id: commentB.id,
      content: 'second detail',
      position_x: commentB.position_x,
      position_y: commentB.position_y,
    })

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [commentA, commentB],
        commentDetailCache: {
          [commentA.id]: baseCommentDetail(),
        },
        rightPanelWidth: 800,
        nodePanelWidth: 300,
        controlMode: ControlMode.Comment,
        activeCommentId: commentA.id,
        pendingComment: { pageX: 1, pageY: 2, elementX: 3, elementY: 4 },
      },
    })

    await act(async () => {
      await result.current.handleCommentNavigate('next')
    })

    await waitFor(() => {
      expect(store.getState().activeCommentId).toBe(commentB.id)
    })
    expect(mockSetCenter).toHaveBeenCalledWith(
      502,
      80,
      { zoom: 1, duration: 600 },
    )

    act(() => {
      result.current.handleCreateComment({
        pageX: 300,
        pageY: 400,
        elementX: 30,
        elementY: 40,
      })
    })
    expect(store.getState().pendingComment).toEqual({
      pageX: 300,
      pageY: 400,
      elementX: 30,
      elementY: 40,
    })

    act(() => {
      result.current.handleActiveCommentClose()
    })
    expect(store.getState().activeCommentId).toBeNull()
    expect(store.getState().activeCommentDetail).toBeNull()
    expect(store.getState().activeCommentDetailLoading).toBe(false)
  })

  it('runs resolve, delete, and reply lifecycle handlers with collaboration sync', async () => {
    const commentA = baseComment()
    const commentB: WorkflowCommentList = {
      ...baseComment(),
      id: 'comment-2',
      content: 'fallback',
      position_x: 33,
      position_y: 55,
    }
    mockFetchWorkflowComments.mockResolvedValue({ data: [commentB] })
    mockFetchWorkflowComment.mockResolvedValue({
      ...baseCommentDetail(),
      id: commentB.id,
      content: 'fallback detail',
      position_x: commentB.position_x,
      position_y: commentB.position_y,
    })

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [commentA, commentB],
        activeCommentId: commentA.id,
      },
    })

    await act(async () => {
      await result.current.handleCommentResolve(commentA.id)
    })

    expect(mockResolveWorkflowComment).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: commentA.id },
    })

    await act(async () => {
      await result.current.handleCommentReply(commentA.id, '  new reply  ', ['user-2'])
      await result.current.handleCommentReplyUpdate(commentA.id, 'reply-1', '  edited reply  ', ['user-2'])
      await result.current.handleCommentReplyDelete(commentA.id, 'reply-1')
    })

    expect(mockCreateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: commentA.id },
      body: {
        content: 'new reply',
        mentioned_user_ids: ['user-2'],
      },
    })
    expect(mockUpdateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: commentA.id, replyId: 'reply-1' },
      body: {
        content: 'edited reply',
        mentioned_user_ids: ['user-2'],
      },
    })
    expect(mockDeleteWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: commentA.id, replyId: 'reply-1' },
    })

    await act(async () => {
      await result.current.handleCommentDelete(commentA.id)
    })

    expect(mockDeleteWorkflowComment).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: commentA.id },
    })
    await waitFor(() => {
      expect(store.getState().activeCommentId).toBe(commentB.id)
    })
    expect(mockEmitCommentsUpdate).toHaveBeenCalled()
  })

  it('does not update a reply when the content is blank', async () => {
    const { result } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
    })

    await act(async () => {
      await result.current.handleCommentReplyUpdate('comment-1', 'reply-1', '   ')
    })

    expect(mockUpdateWorkflowCommentReply).not.toHaveBeenCalled()
  })

  it('resets reply submit loading when creation fails', async () => {
    mockCreateWorkflowCommentReply.mockRejectedValueOnce(new Error('create reply failed'))

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        replySubmitting: false,
      },
    })

    await act(async () => {
      await result.current.handleCommentReply('comment-1', 'new reply')
    })

    expect(mockCreateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: 'comment-1' },
      body: {
        content: 'new reply',
        mentioned_user_ids: [],
      },
    })
    expect(store.getState().replySubmitting).toBe(false)
  })

  it('resets reply update loading when update fails', async () => {
    mockUpdateWorkflowCommentReply.mockRejectedValueOnce(new Error('update failed'))

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        replyUpdating: false,
      },
    })

    await act(async () => {
      await result.current.handleCommentReplyUpdate('comment-1', 'reply-1', 'updated reply')
    })

    expect(mockUpdateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: 'comment-1', replyId: 'reply-1' },
      body: {
        content: 'updated reply',
        mentioned_user_ids: [],
      },
    })
    expect(store.getState().replyUpdating).toBe(false)
  })

  it('resets reply delete loading when deletion fails', async () => {
    mockDeleteWorkflowCommentReply.mockRejectedValueOnce(new Error('delete failed'))

    const { result, store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        activeCommentDetailLoading: false,
      },
    })

    await act(async () => {
      await result.current.handleCommentReplyDelete('comment-1', 'reply-1')
    })

    expect(mockDeleteWorkflowCommentReply).toHaveBeenCalledWith({
      params: { appId: 'app-1', commentId: 'comment-1', replyId: 'reply-1' },
    })
    expect(store.getState().activeCommentDetailLoading).toBe(false)
  })

  it('ignores navigation when no active comment or active comment is absent from the list', () => {
    const { result } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [baseComment()],
      },
    })

    act(() => {
      result.current.handleCommentNavigate('next')
    })

    expect(mockSetCenter).not.toHaveBeenCalled()

    act(() => {
      result.current.handleCommentIconClick({ ...baseComment(), id: 'missing-comment' })
    })

    mockSetCenter.mockClear()

    act(() => {
      result.current.handleCommentNavigate('next')
    })

    expect(mockSetCenter).not.toHaveBeenCalled()
  })

  it('clears a pending comment when comment mode is left outside quick add', () => {
    const { store } = renderWorkflowHook(() => useWorkflowComment(), {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        controlMode: ControlMode.Pointer,
        isCommentQuickAdd: false,
        pendingComment: { pageX: 1, pageY: 2, elementX: 3, elementY: 4 },
      },
    })

    expect(store.getState().pendingComment).toBeNull()
  })
})
