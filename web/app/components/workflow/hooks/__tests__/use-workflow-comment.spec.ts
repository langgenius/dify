import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import { useWorkflowComment } from '../use-workflow-comment'

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
const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'alice.png',
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflow.comments.get': mockFetchWorkflowComments,
      'apps.byAppId.workflow.comments.post': mockCreateWorkflowComment,
      'apps.byAppId.workflow.comments.byCommentId.delete': mockDeleteWorkflowComment,
      'apps.byAppId.workflow.comments.byCommentId.get': mockFetchWorkflowComment,
      'apps.byAppId.workflow.comments.byCommentId.put': mockUpdateWorkflowComment,
      'apps.byAppId.workflow.comments.byCommentId.resolve.post': mockResolveWorkflowComment,
      'apps.byAppId.workflow.comments.byCommentId.replies.post': mockCreateWorkflowCommentReply,
      'apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete':
        mockDeleteWorkflowCommentReply,
      'apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.put':
        mockUpdateWorkflowCommentReply,
    }),
  }
})

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitCommentsUpdate: (...args: unknown[]) => mockEmitCommentsUpdate(...args),
    onCommentsUpdate: (handler: () => void) => {
      commentsUpdateState.handler = handler
      return mockUnsubscribeCommentsUpdate
    },
  },
}))

const baseComment = (): WorkflowCommentBasic => ({
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
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(queryClient, mockConsoleState.userProfile)
  seedSystemFeatures(queryClient, {
    enable_collaboration_mode: globalFeatureState.enableCollaboration,
  })
  return queryClient
}

const useCommentCanvas = () => ({ ...useWorkflowComment(), flow: useReactFlow() })

const renderWorkflowHook: typeof renderWorkflowFlowHook = (hook, options) =>
  renderWorkflowFlowHook(hook, {
    ...options,
    reactFlowProps: { fitView: false, defaultViewport: { x: 80, y: 160, zoom: 2 } },
  })

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
    mockCreateWorkflowCommentReply.mockResolvedValue({})
    mockUpdateWorkflowCommentReply.mockResolvedValue({})
    mockDeleteWorkflowCommentReply.mockResolvedValue({})
    mockResolveWorkflowComment.mockResolvedValue({})
    mockDeleteWorkflowComment.mockResolvedValue({})
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads comment list on mount when collaboration is enabled', async () => {
    const comment = baseComment()
    mockFetchWorkflowComments.mockResolvedValue({ data: [comment] })

    const { store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
    })

    await waitFor(() => {
      expect(mockFetchWorkflowComments).toHaveBeenCalledWith({
        params: { app_id: 'app-1' },
      })
    })

    expect(store.getState().comments).toEqual([comment])
    expect(store.getState().commentsLoading).toBe(false)
  })

  it('does not load comment list when collaboration is disabled', async () => {
    globalFeatureState.enableCollaboration = false

    renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
    })

    await Promise.resolve()

    expect(mockFetchWorkflowComments).not.toHaveBeenCalled()
  })

  it('creates a comment, updates local cache, and emits collaboration sync', async () => {
    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 100, elementY: 200 },
        isCommentQuickAdd: true,
        mentionableUsersCache: {
          'app-1': [
            {
              id: 'user-2',
              name: 'Bob',
              email: 'bob@example.com',
              avatar_url: 'bob.png',
            },
          ],
        },
      },
    })

    await act(async () => {
      await result.current.handleCommentSubmit('new message', ['user-2'])
    })

    expect(mockCreateWorkflowComment).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
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
    expect(comments[0]?.participants.map((p) => p.id)).toEqual(['user-1', 'user-2'])
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

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 100, elementY: 200 },
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

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [],
        pendingComment: { pageX: 100, pageY: 200, elementX: 100, elementY: 200 },
        isCommentQuickAdd: true,
        mentionableUsersCache: {
          'app-1': [
            {
              id: 'user-2',
              name: 'Bob',
              email: 'bob@example.com',
              avatar_url: 'bob.png',
            },
          ],
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
      participants: [
        {
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          avatar_url: 'alice.png',
        },
      ],
    })
    expect(store.getState().commentDetailCache['comment-date-time']?.mentions).toEqual([
      {
        mentioned_user_id: 'missing-user',
        mentioned_user_account: null,
        reply_id: null,
      },
    ])
  })

  it('rolls back optimistic position update when API update fails', async () => {
    const comment = baseComment()
    const commentDetail = baseCommentDetail()
    mockUpdateWorkflowComment.mockRejectedValue(new Error('update failed'))

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
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
      params: { app_id: 'app-1', comment_id: comment.id },
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

    const { unmount, result } = renderWorkflowHook(useCommentCanvas, {
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
        params: { app_id: 'app-1', comment_id: comment.id },
      })
    })
    await waitFor(() =>
      expect(result.current.activeComment?.content).toBe('updated by another user'),
    )
    expect(result.current.comments).toEqual([comment])

    unmount()
    expect(mockUnsubscribeCommentsUpdate).toHaveBeenCalledTimes(1)
  })

  it('focuses comment thread, loads detail, and updates navigation/create/close states', async () => {
    vi.stubGlobal('innerWidth', 1600)
    const commentA = baseComment()
    const commentB: WorkflowCommentBasic = {
      ...baseComment(),
      id: 'comment-2',
      content: 'second',
      position_x: 50,
      position_y: 80,
    }
    mockFetchWorkflowComment.mockResolvedValue({
      ...baseCommentDetail(),
      id: commentB.id,
      content: 'second detail',
      position_x: commentB.position_x,
      position_y: commentB.position_y,
    })

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      nodes: [createNode({ id: 'node-1', data: { selected: true } })],
      initialStoreState: {
        comments: [commentA, commentB],
        commentDetailCache: {
          [commentA.id]: baseCommentDetail(),
        },
        rightPanelWidth: 0,
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
    await waitFor(() =>
      expect(result.current.flow.getViewport()).toEqual({ x: -380, y: 170, zoom: 1 }),
    )
    expect(result.current.activeComment?.content).toBe('second detail')

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
    const commentB: WorkflowCommentBasic = {
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

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
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
      params: { app_id: 'app-1', comment_id: commentA.id },
    })

    await act(async () => {
      await result.current.handleCommentReply(commentA.id, '  new reply  ', ['user-2'])
      await result.current.handleCommentReplyUpdate(commentA.id, 'reply-1', '  edited reply  ', [
        'user-2',
      ])
      await result.current.handleCommentReplyDelete(commentA.id, 'reply-1')
    })

    expect(mockCreateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { app_id: 'app-1', comment_id: commentA.id },
      body: {
        content: 'new reply',
        mentioned_user_ids: ['user-2'],
      },
    })
    expect(mockUpdateWorkflowCommentReply).toHaveBeenCalledWith({
      params: { app_id: 'app-1', comment_id: commentA.id, reply_id: 'reply-1' },
      body: {
        content: 'edited reply',
        mentioned_user_ids: ['user-2'],
      },
    })
    expect(mockDeleteWorkflowCommentReply).toHaveBeenCalledWith({
      params: { app_id: 'app-1', comment_id: commentA.id, reply_id: 'reply-1' },
    })

    await act(async () => {
      await result.current.handleCommentDelete(commentA.id)
    })

    expect(mockDeleteWorkflowComment).toHaveBeenCalledWith({
      params: { app_id: 'app-1', comment_id: commentA.id },
    })
    await waitFor(() => {
      expect(store.getState().activeCommentId).toBe(commentB.id)
    })
    expect(mockEmitCommentsUpdate).toHaveBeenCalled()
  })

  it('does not update a reply when the content is blank', async () => {
    const { result } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
    })

    await act(async () => {
      await result.current.handleCommentReplyUpdate('comment-1', 'reply-1', '   ')
    })

    expect(mockUpdateWorkflowCommentReply).not.toHaveBeenCalled()
  })

  it.each(['create', 'update', 'delete'] as const)(
    'keeps reply %s pending until failure, then permits retry',
    async (operation) => {
      const request =
        operation === 'create'
          ? mockCreateWorkflowCommentReply
          : operation === 'update'
            ? mockUpdateWorkflowCommentReply
            : mockDeleteWorkflowCommentReply
      let rejectRequest!: (error: Error) => void
      request.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        }),
      )
      const { result } = renderWorkflowHook(useCommentCanvas, {
        queryClient: createSeededQueryClient(),
      })
      await waitFor(() => expect(result.current.loading).toBe(false))
      const submit = () =>
        operation === 'create'
          ? result.current.handleCommentReply('comment-1', 'new reply')
          : operation === 'update'
            ? result.current.handleCommentReplyUpdate('comment-1', 'reply-1', 'updated reply')
            : result.current.handleCommentReplyDelete('comment-1', 'reply-1')
      const isPending = () =>
        operation === 'create'
          ? result.current.replySubmitting
          : operation === 'update'
            ? result.current.replyUpdating
            : result.current.activeCommentLoading
      let pending!: Promise<void>
      act(() => {
        pending = submit()
      })
      expect(isPending()).toBe(true)
      await act(async () => {
        rejectRequest(new Error('Request failed'))
        await pending
      })
      expect(isPending()).toBe(false)
      expect(mockEmitCommentsUpdate).not.toHaveBeenCalled()
      await act(async () => {
        await submit()
      })
      expect(request).toHaveBeenCalledTimes(2)
      expect(mockEmitCommentsUpdate).toHaveBeenCalledWith('app-1')
      expect(isPending()).toBe(false)
    },
  )

  it('keeps the selected thread loading when an earlier thread request finishes', async () => {
    const first = baseComment()
    const second = { ...first, id: 'comment-2', content: 'second' }
    let resolveFirst!: (detail: WorkflowCommentDetail) => void
    let resolveSecond!: (detail: WorkflowCommentDetail) => void
    mockFetchWorkflowComment
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )
    const { result } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
    })
    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>
    act(() => {
      firstRequest = result.current.handleCommentIconClick(first)
    })
    act(() => {
      secondRequest = result.current.handleCommentIconClick(second)
    })
    await act(async () => {
      resolveFirst(baseCommentDetail())
      await firstRequest
    })
    expect(result.current.activeComment?.id).toBe(second.id)
    expect(result.current.activeCommentLoading).toBe(true)
    await act(async () => {
      resolveSecond({ ...baseCommentDetail(), id: second.id, content: 'second detail' })
      await secondRequest
    })
    expect(result.current.activeComment?.content).toBe('second detail')
    expect(result.current.activeCommentLoading).toBe(false)
  })

  it('ignores navigation when no active comment or active comment is absent from the list', async () => {
    const { result } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [baseComment()],
      },
    })

    act(() => {
      result.current.handleCommentNavigate('next')
    })

    expect(result.current.flow.getViewport()).toEqual({ x: 80, y: 160, zoom: 2 })

    await act(async () => {
      await result.current.handleCommentIconClick({ ...baseComment(), id: 'missing-comment' })
    })
    await waitFor(() =>
      expect(result.current.flow.getViewport()).toEqual({ x: 20, y: 230, zoom: 1 }),
    )
    const viewport = result.current.flow.getViewport()

    act(() => {
      result.current.handleCommentNavigate('next')
    })

    expect(result.current.flow.getViewport()).toEqual(viewport)
  })

  it('clears a pending comment when comment mode is left outside quick add', () => {
    const { store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        controlMode: ControlMode.Pointer,
        isCommentQuickAdd: false,
        pendingComment: { pageX: 1, pageY: 2, elementX: 3, elementY: 4 },
      },
    })

    expect(store.getState().pendingComment).toBeNull()
  })

  it('does not overwrite the active comment when a different comment is resolved/refreshed', async () => {
    const commentA = baseComment()
    const commentB: WorkflowCommentBasic = {
      ...baseComment(),
      id: 'comment-2',
      content: 'second',
      position_x: 50,
      position_y: 80,
    }
    const activeBDetail = { ...baseCommentDetail(), id: commentB.id, content: 'B detail' }
    // refreshActiveComment(A) — reached via resolving A — fetches A's detail:
    mockFetchWorkflowComment.mockResolvedValue({
      ...baseCommentDetail(),
      id: commentA.id,
      content: 'A detail (must not clobber B)',
    })
    mockResolveWorkflowComment.mockResolvedValue({})
    mockFetchWorkflowComments.mockResolvedValue({
      data: [{ ...commentA, resolved: true }, commentB],
    })

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [commentA, commentB],
        activeCommentId: commentB.id,
        activeCommentDetail: activeBDetail,
      },
    })

    await act(async () => {
      await result.current.handleCommentResolve(commentA.id)
    })

    // B is still the selected comment; A's fetched detail must not replace it.
    expect(store.getState().activeCommentId).toBe(commentB.id)
    expect(store.getState().activeCommentDetail?.id).toBe(commentB.id)
  })

  it('still refreshes the active comment', async () => {
    const commentA = baseComment()
    mockFetchWorkflowComment.mockResolvedValue({
      ...baseCommentDetail(),
      id: commentA.id,
      content: 'refreshed content',
    })

    const { result, store } = renderWorkflowHook(useCommentCanvas, {
      queryClient: createSeededQueryClient(),
      initialStoreState: {
        comments: [commentA],
        activeCommentId: commentA.id,
        activeCommentDetail: {
          ...baseCommentDetail(),
          id: commentA.id,
          content: 'stale content',
        },
      },
    })

    await act(async () => {
      await result.current.refreshActiveComment(commentA.id)
    })

    expect(store.getState().activeCommentDetail?.id).toBe(commentA.id)
    expect(store.getState().activeCommentDetail?.content).toBe('refreshed content')
  })
})
