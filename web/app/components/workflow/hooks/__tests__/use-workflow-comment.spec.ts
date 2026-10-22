import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import { useWorkflowComment } from '../use-workflow-comment'

const viewport = vi.hoisted(() => ({
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x: x - 90, y: y - 180 })),
  setCenter: vi.fn(),
  getNodes: vi.fn(() => []),
}))
const collaboration = vi.hoisted(() => ({
  emit: vi.fn(),
  handlers: new Set<(update: { appId: string; timestamp: number }) => void>(),
}))
vi.mock('reactflow', () => ({ useReactFlow: () => viewport }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitCommentsUpdate: collaboration.emit,
    onCommentsUpdate: (handler: (update: { appId: string; timestamp: number }) => void) => {
      collaboration.handlers.add(handler)
      return () => collaboration.handlers.delete(handler)
    },
  },
}))

const author = { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: 'alice.png' }
const comment = (id = 'comment-1'): WorkflowCommentBasic => ({
  id,
  content: id === 'comment-1' ? 'hello' : 'second',
  position_x: 10,
  position_y: 20,
  created_by: author.id,
  created_by_account: author,
  created_at: 100,
  updated_at: 100,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [author],
})
const detail = (id = 'comment-1'): WorkflowCommentDetail => ({
  ...comment(id),
  replies: [],
  mentions: [],
})
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const failure = (message: string) => json({ code: 'invalid_param', message, status: 400 }, 400)
type Responder = (request: Request) => Promise<Response>
const api = {
  list: vi.fn<Responder>(),
  detail: vi.fn<Responder>(),
  create: vi.fn<Responder>(),
  update: vi.fn<Responder>(),
  remove: vi.fn<Responder>(),
  resolve: vi.fn<Responder>(),
  reply: vi.fn<Responder>(),
  editReply: vi.fn<Responder>(),
  removeReply: vi.fn<Responder>(),
}
let listed: WorkflowCommentBasic[]
let details: Map<string, WorkflowCommentDetail>
const requests: Request[] = []
const network = vi.fn<typeof fetch>()
const listKey = (appId = 'app-1') =>
  consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
    input: { params: { app_id: appId } },
  })
const detailKey = (id: string, appId = 'app-1') =>
  consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
    input: { params: { app_id: appId, comment_id: id } },
  })
const client = (enabled = true) => {
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(queryClient, author)
  seedSystemFeatures(queryClient, { enable_collaboration_mode: enabled })
  return queryClient
}
function renderComments(options: NonNullable<Parameters<typeof renderWorkflowHook>[1]> = {}) {
  const queryClient = options.queryClient ?? client()
  return {
    ...renderWorkflowHook(() => useWorkflowComment(), { ...options, queryClient }),
    queryClient,
  }
}
const ready = async (result: ReturnType<typeof renderComments>['result']) => {
  await waitFor(() => expect(result.current.comments).toEqual(listed))
  await waitFor(() => expect(result.current.loading).toBe(false))
}
const open = async (result: ReturnType<typeof renderComments>['result'], item = comment()) => {
  await act(async () => {
    await result.current.handleCommentIconClick(item)
  })
  await waitFor(() => expect(result.current.activeCommentLoading).toBe(false))
}
const remoteUpdate = (appId = 'app-1') => {
  for (const handler of collaboration.handlers) handler({ appId, timestamp: Date.now() })
}

beforeEach(() => {
  vi.resetAllMocks()
  collaboration.handlers.clear()
  listed = [comment(), comment('comment-2')]
  details = new Map(listed.map((item) => [item.id, detail(item.id)]))
  requests.length = 0
  api.list.mockImplementation(async () => json({ data: listed }))
  api.detail.mockImplementation(async (request) => {
    const id = new URL(request.url).pathname.split('/').at(-1) ?? ''
    return json(details.get(id) ?? detail(id))
  })
  api.create.mockImplementation(async () =>
    json({ id: 'new-comment', created_at: 1700000000 }, 201),
  )
  api.update.mockImplementation(async () => json({ id: 'comment-1', updated_at: 200 }))
  api.remove.mockImplementation(async () => json({ result: 'success' }))
  api.resolve.mockImplementation(async () => json({ id: 'comment-1', resolved: true }))
  api.reply.mockImplementation(async () => json({ id: 'reply-1', created_at: 200 }, 201))
  api.editReply.mockImplementation(async () => json({ id: 'reply-1', updated_at: 300 }))
  api.removeReply.mockImplementation(async () => json({ result: 'success' }))
  viewport.screenToFlowPosition.mockImplementation(({ x, y }) => ({ x: x - 90, y: y - 180 }))
  viewport.getNodes.mockReturnValue([])
  network.mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    const path = new URL(request.url).pathname
    const match =
      /^\/console\/api\/apps\/[^/]+\/workflow\/comments(?:\/([^/]+))?(?:\/(replies|resolve))?(?:\/([^/]+))?$/.exec(
        path,
      )
    if (!match) throw new Error(`Unexpected request: ${request.method} ${path}`)
    const [, id, action, replyId] = match
    const handler =
      request.method === 'GET'
        ? id
          ? api.detail
          : api.list
        : request.method === 'DELETE'
          ? replyId
            ? api.removeReply
            : api.remove
          : request.method === 'PUT'
            ? replyId
              ? api.editReply
              : api.update
            : !id
              ? api.create
              : action === 'resolve'
                ? api.resolve
                : api.reply
    return handler(request)
  })
  vi.stubGlobal('fetch', network)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('workflow comment data and commands', () => {
  it('loads once for two consumers in the same editor and shares live updates', async () => {
    const queryClient = client()
    const { result, unmount } = renderWorkflowHook(
      () => [useWorkflowComment(), useWorkflowComment()] as const,
      { queryClient },
    )
    await waitFor(() => expect(result.current[0].comments).toEqual(listed))
    expect(result.current[1].comments).toEqual(listed)
    expect(api.list).toHaveBeenCalledOnce()

    listed = [comment(), { ...comment('comment-2'), content: 'Updated remotely' }]
    act(() => remoteUpdate())
    await waitFor(() => expect(result.current[0].comments[1]?.content).toBe('Updated remotely'))
    expect(result.current[1].comments).toEqual(listed)
    unmount()
    expect(collaboration.handlers.size).toBe(0)
  })

  it.each(['disabled', 'pipeline'] as const)(
    'does not request comments for a %s editor',
    async (kind) => {
      const { result } = renderComments({
        queryClient: client(kind !== 'disabled'),
        ...(kind === 'pipeline'
          ? { resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' } }
          : {}),
      })
      await act(async () => {})
      expect(network).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
      expect(result.current.comments).toEqual([])
    },
  )

  it('ignores collaboration events for another app', async () => {
    const { result } = renderComments()
    await ready(result)
    act(() => remoteUpdate('other-app'))
    await act(async () => {})
    expect(api.list).toHaveBeenCalledOnce()
  })

  it('keeps cached comment records isolated between apps', async () => {
    const queryClient = client()
    const other = { ...comment(), content: 'Another app' }
    queryClient.setQueryData(listKey('app-2'), { data: [other] })
    const { result } = renderComments({ queryClient })
    await ready(result)
    await open(result)
    const cachedOther = queryClient.getQueryData(listKey('app-2'))
    api.resolve.mockImplementation(async () => {
      listed = listed.map((item) => ({ ...item, resolved: item.id === 'comment-1' }))
      details.set('comment-1', { ...detail(), resolved: true })
      return json({ id: 'comment-1', resolved: true })
    })
    await act(async () => {
      await result.current.handleCommentResolve('comment-1')
    })
    await waitFor(() => expect(result.current.activeComment?.resolved).toBe(true))
    expect(queryClient.getQueryData(listKey('app-2'))).toBe(cachedOther)
    expect(
      requests
        .filter((request) => !request.url.includes('/apps/app-1/'))
        .map((request) => request.url),
    ).toEqual([])
  })

  it.each([1700000000, '1700000000', '2024-01-02T03:04:05.000Z'])(
    'creates a comment with mentions and preserves timestamp %s',
    async (createdAt) => {
      api.create.mockImplementation(async () =>
        json({ id: 'new-comment', created_at: createdAt }, 201),
      )
      const { result, store, queryClient } = renderComments({
        initialStoreState: {
          pendingComment: { pageX: 100, pageY: 200, elementX: 10, elementY: 20 },
          isCommentQuickAdd: true,
          mentionableUsersCache: {
            'app-1': [{ id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: null }],
          },
        },
      })
      await ready(result)
      await act(async () => {
        await result.current.handleCommentSubmit('new message', ['user-2', 'missing-user'])
      })
      const sent = api.create.mock.calls[0]?.[0]
      expect(await sent?.clone().json()).toEqual({
        position_x: 10,
        position_y: 20,
        content: 'new message',
        mentioned_user_ids: ['user-2', 'missing-user'],
      })
      const expectedTime =
        typeof createdAt === 'number'
          ? createdAt
          : Number(createdAt) || Date.parse(createdAt) / 1000
      await waitFor(() =>
        expect(result.current.comments.at(-1)).toMatchObject({
          id: 'new-comment',
          content: 'new message',
          created_at: expectedTime,
          participants: [author, expect.objectContaining({ id: 'user-2' })],
        }),
      )
      expect(queryClient.getQueryData(detailKey('new-comment'))?.mentions.at(-1)).toEqual({
        mentioned_user_id: 'missing-user',
        mentioned_user_account: null,
        reply_id: null,
      })
      expect(store.getState().pendingComment).toBeNull()
      expect(store.getState().isCommentQuickAdd).toBe(false)
      expect(collaboration.emit).toHaveBeenCalledWith('app-1')
    },
  )

  it('refreshes both the list and the active thread after a remote change', async () => {
    const { result } = renderComments()
    await ready(result)
    await open(result)
    details.set('comment-1', { ...detail(), content: 'Remote edit' })
    listed = [{ ...comment(), content: 'Remote edit' }, comment('comment-2')]
    act(() => remoteUpdate())
    await waitFor(() => expect(result.current.activeComment?.content).toBe('Remote edit'))
    expect(result.current.comments[0]?.content).toBe('Remote edit')
  })

  it('keeps the selected thread when a different comment is resolved', async () => {
    api.resolve.mockImplementation(async () => {
      listed = [{ ...comment(), resolved: true }, comment('comment-2')]
      return json({ id: 'comment-1', resolved: true })
    })
    const { result, store } = renderComments()
    await ready(result)
    await open(result, comment('comment-2'))
    await act(async () => {
      await result.current.handleCommentResolve('comment-1')
    })
    await waitFor(() => expect(result.current.comments[0]?.resolved).toBe(true))
    expect(store.getState().activeCommentId).toBe('comment-2')
    expect(result.current.activeComment).toMatchObject({ id: 'comment-2', resolved: false })
  })

  it('does not replace the selected thread when an earlier request finishes', async () => {
    const first = createDeferred<Response>()
    const second = createDeferred<Response>()
    api.detail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderComments()
    await ready(result)
    let firstRequest: Promise<void>
    let secondRequest: Promise<void>
    act(() => {
      firstRequest = result.current.handleCommentIconClick(comment())
    })
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(1))
    act(() => {
      secondRequest = result.current.handleCommentIconClick(comment('comment-2'))
    })
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2))
    await act(async () => {
      first.resolve(json(detail()))
      await firstRequest
    })
    expect(result.current.activeComment?.id).toBe('comment-2')
    expect(result.current.activeCommentLoading).toBe(true)
    await act(async () => {
      second.resolve(json({ ...detail('comment-2'), content: 'Second detail' }))
      await secondRequest
    })
    await waitFor(() => expect(result.current.activeComment?.content).toBe('Second detail'))
    expect(result.current.activeCommentLoading).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not reopen a closed thread when its response arrives', async () => {
    const pending = createDeferred<Response>()
    api.detail.mockReturnValue(pending.promise)
    const { result, store } = renderComments()
    await ready(result)
    let request: Promise<void>
    act(() => {
      request = result.current.handleCommentIconClick(comment())
    })
    await waitFor(() => expect(api.detail).toHaveBeenCalledOnce())
    act(() => result.current.handleActiveCommentClose())
    await act(async () => {
      pending.resolve(json(detail()))
      await request
    })
    expect(result.current.activeComment).toBeNull()
    expect(store.getState().activeCommentId).toBeNull()
    expect(result.current.activeCommentLoading).toBe(false)
  })

  it('rolls back a failed move without losing another comment updated while it was pending', async () => {
    const pending = createDeferred<Response>()
    api.update.mockReturnValueOnce(pending.promise)
    const { result } = renderComments()
    await ready(result)
    await open(result)
    let move: Promise<void>
    act(() => {
      move = result.current.handleCommentPositionUpdate('comment-1', { x: 300, y: 400 })
    })
    await waitFor(() => expect(result.current.comments[0]?.position_x).toBe(300))
    listed = [comment(), { ...comment('comment-2'), content: 'Concurrent edit' }]
    act(() => remoteUpdate())
    await waitFor(() => expect(result.current.comments[1]?.content).toBe('Concurrent edit'))
    await act(async () => {
      pending.resolve(failure('Move failed'))
      await move
    })
    await waitFor(() => expect(result.current.comments[0]?.position_x).toBe(10))
    expect(result.current.comments[1]?.content).toBe('Concurrent edit')
    expect(result.current.activeComment?.position_x).toBe(10)
    expect(collaboration.emit).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Move failed')
  })

  it('moves the selected comment and refreshes its server values', async () => {
    api.update.mockImplementation(async (request) => {
      const body = await request.clone().json()
      listed = listed.map((item) => (item.id === 'comment-1' ? { ...item, ...body } : item))
      details.set('comment-1', { ...detail(), ...body })
      return json({ id: 'comment-1', updated_at: 200 })
    })
    const { result } = renderComments()
    await ready(result)
    await open(result)
    await act(async () => {
      await result.current.handleCommentPositionUpdate('comment-1', { x: 30, y: 40 })
    })
    await waitFor(() =>
      expect(result.current.activeComment).toMatchObject({ position_x: 30, position_y: 40 }),
    )
    expect(result.current.comments[0]).toMatchObject({ position_x: 30, position_y: 40 })
    expect(collaboration.emit).toHaveBeenCalledWith('app-1')
  })

  it('refreshes replies and counts after create, edit and delete', async () => {
    const reply = {
      id: 'reply-1',
      content: 'new reply',
      created_by: author.id,
      created_by_account: author,
      created_at: 200,
    }
    api.reply.mockImplementation(async () => {
      details.set('comment-1', { ...detail(), replies: [reply] })
      listed = [{ ...comment(), reply_count: 1 }, comment('comment-2')]
      return json({ id: reply.id, created_at: 200 }, 201)
    })
    api.editReply.mockImplementation(async () => {
      details.set('comment-1', { ...detail(), replies: [{ ...reply, content: 'edited reply' }] })
      return json({ id: reply.id, updated_at: 300 })
    })
    api.removeReply.mockImplementation(async () => {
      details.set('comment-1', detail())
      listed = [comment(), comment('comment-2')]
      return json({ result: 'success' })
    })
    const { result } = renderComments()
    await ready(result)
    await open(result)
    await act(async () => {
      await result.current.handleCommentReply('comment-1', '  new reply  ', ['user-2'])
    })
    await waitFor(() => expect(result.current.activeComment?.replies[0]?.content).toBe('new reply'))
    expect(result.current.comments[0]?.reply_count).toBe(1)
    expect(await api.reply.mock.calls[0]?.[0].clone().json()).toEqual({
      content: 'new reply',
      mentioned_user_ids: ['user-2'],
    })
    await act(async () => {
      await result.current.handleCommentReplyUpdate('comment-1', reply.id, '  edited reply  ')
    })
    await waitFor(() =>
      expect(result.current.activeComment?.replies[0]?.content).toBe('edited reply'),
    )
    await act(async () => {
      await result.current.handleCommentReplyDelete('comment-1', reply.id)
    })
    await waitFor(() => expect(result.current.activeComment?.replies).toEqual([]))
    expect(result.current.comments[0]?.reply_count).toBe(0)
  })

  it.each(['create', 'edit', 'delete'] as const)(
    'keeps reply %s pending for both consumers until failure and permits retry',
    async (operation) => {
      const responder =
        operation === 'create' ? api.reply : operation === 'edit' ? api.editReply : api.removeReply
      const pending = createDeferred<Response>()
      responder.mockReturnValueOnce(pending.promise)
      const queryClient = client()
      const { result } = renderWorkflowHook(
        () => [useWorkflowComment(), useWorkflowComment()] as const,
        { queryClient, initialStoreState: { activeCommentId: 'comment-1' } },
      )
      await waitFor(() => expect(result.current[0].activeCommentLoading).toBe(false))
      const invoke = () =>
        operation === 'create'
          ? result.current[0].handleCommentReply('comment-1', 'reply')
          : operation === 'edit'
            ? result.current[0].handleCommentReplyUpdate('comment-1', 'reply-1', 'edited')
            : result.current[0].handleCommentReplyDelete('comment-1', 'reply-1')
      const busy = (index: 0 | 1) =>
        operation === 'create'
          ? result.current[index].replySubmitting
          : operation === 'edit'
            ? result.current[index].replyUpdating
            : result.current[index].activeCommentLoading
      let request: Promise<void>
      act(() => {
        request = invoke()
      })
      await waitFor(() => {
        expect(busy(0)).toBe(true)
        expect(busy(1)).toBe(true)
      })
      await act(async () => {
        pending.resolve(failure(`Cannot ${operation} reply`))
        await request
      })
      await waitFor(() => {
        expect(busy(0)).toBe(false)
        expect(busy(1)).toBe(false)
      })
      expect(collaboration.emit).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(`Cannot ${operation} reply`)
      await act(async () => {
        await invoke()
      })
      expect(responder).toHaveBeenCalledTimes(2)
      expect(collaboration.emit).toHaveBeenCalledWith('app-1')
    },
  )

  it.each([false, true])(
    'deletes the selected comment and handles an empty list: %s',
    async (last) => {
      if (last) listed = [comment()]
      api.remove.mockImplementation(async () => {
        listed = last ? [] : [comment('comment-2')]
        return json({ result: 'success' })
      })
      const { result, store, queryClient } = renderComments()
      await ready(result)
      await open(result)
      await act(async () => {
        await result.current.handleCommentDelete('comment-1')
      })
      if (last) {
        await waitFor(() => expect(result.current.activeComment).toBeNull())
        expect(store.getState().activeCommentId).toBeNull()
      } else {
        await waitFor(() => expect(result.current.activeComment?.id).toBe('comment-2'))
        expect(store.getState().activeCommentId).toBe('comment-2')
      }
      await waitFor(() => expect(result.current.comments).toEqual(listed))
      expect(queryClient.getQueryData(detailKey('comment-1'))).toBeUndefined()
    },
  )

  it('preserves editing, navigation and viewport commands', async () => {
    const { result, store } = renderComments({
      initialStoreState: { controlMode: ControlMode.Comment, rightPanelWidth: 800 },
    })
    await ready(result)
    await open(result)
    expect(viewport.setCenter).toHaveBeenCalledWith(462, 20, { zoom: 1, duration: 600 })
    await act(async () => {
      await result.current.handleCommentUpdate('comment-1', '  revised  ', ['user-2'])
    })
    expect(await api.update.mock.calls[0]?.[0].clone().json()).toEqual({
      content: 'revised',
      position_x: 10,
      position_y: 20,
      mentioned_user_ids: ['user-2'],
    })
    act(() => result.current.handleCommentNavigate('next'))
    await waitFor(() => expect(result.current.activeComment?.id).toBe('comment-2'))
    act(() => result.current.handleCreateComment({ pageX: 3, pageY: 4, elementX: 5, elementY: 6 }))
    expect(store.getState().pendingComment?.pageX).toBe(3)
    act(() => result.current.handleCommentCancel())
    expect(store.getState().pendingComment).toBeNull()
    act(() => result.current.handleActiveCommentClose())
    expect(result.current.activeComment).toBeNull()
  })

  it('does not send empty edits or replies', async () => {
    const { result } = renderComments()
    await ready(result)
    await act(async () => {
      await result.current.handleCommentUpdate('comment-1', '  ')
      await result.current.handleCommentReply('comment-1', '  ')
      await result.current.handleCommentReplyUpdate('comment-1', 'reply-1', '  ')
    })
    expect(api.update).not.toHaveBeenCalled()
    expect(api.reply).not.toHaveBeenCalled()
    expect(api.editReply).not.toHaveBeenCalled()
  })
})
