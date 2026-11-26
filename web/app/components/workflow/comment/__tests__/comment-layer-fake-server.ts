import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import { networkError, pendingResponse } from '@/test/fake-api'

// The server, request handlers and collaboration channel the comment layer browser specs
// stand in for. It loads nothing the specs mock, so their mock factories can import it.

export const api = {
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  reply: vi.fn(),
  updateReply: vi.fn(),
  detailFails: false,
  // Each thread read, by comment id.
  detail: vi.fn(),
  // While set, thread reads never answer.
  detailsPending: false,
  // While set, a list read answers with the list as it was when asked, once the gate opens.
  listGate: undefined as undefined | Promise<unknown>,
}
export const collaboration = {
  handler: undefined as undefined | (() => void),
  emit: vi.fn(),
}

type Server = { list: WorkflowCommentBasic[]; details: Record<string, WorkflowCommentDetail> }
export const server: { current: Server } = { current: { list: [], details: {} } }

export const author = { id: 'author', name: 'Alice', email: 'alice@example.com', avatar_url: null }
// When set, every response uses the same stable URL for the author's current avatar.
export const avatar = { url: undefined as undefined | string }
// A response is a copy of the server's data, as over the network.
const responseCopy = <T>(data: T): T => {
  const url = avatar.url
  return JSON.parse(
    JSON.stringify(data, (key, value) =>
      url && key === 'created_by_account' && value?.id === author.id
        ? { ...value, avatar_url: url }
        : value,
    ),
  ) as T
}

export const listItem = (
  id: string,
  content: string,
  x: number,
  y = 120,
): WorkflowCommentBasic => ({
  id,
  position_x: x,
  position_y: y,
  content,
  created_by: author.id,
  created_by_account: author,
  created_at: 100,
  updated_at: 100,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
})
const setServer = (...items: WorkflowCommentBasic[]) => {
  server.current = {
    list: items,
    details: Object.fromEntries(
      items.map((item) => [item.id, { ...item, replies: [], mentions: [] }]),
    ),
  }
}
export const saveReplyOnServer = (commentId: string, content: string, id = `reply-${content}`) => {
  const createdAt = Math.floor(Date.now() / 1000)
  server.current.details[commentId]!.replies.push({
    id,
    content,
    created_at: createdAt,
    created_by: author.id,
    created_by_account: author,
  })
  return { id, created_at: createdAt }
}

type CommentParams = { params: { app_id: string; comment_id: string } }

// Handlers for the fake API: reads come from the server above, writes go to the `api` spies.
export const commentLayerApi = () => ({
  console: {
    apps: {
      byAppId: {
        workflow: {
          comments: {
            get: async () => {
              const data = responseCopy(server.current.list)
              await api.listGate
              return { data }
            },
            mentionUsers: { get: () => ({ users: [] }) },
            post: async (input: unknown) =>
              (await api.create(input)) ?? { id: 'created-comment', created_at: 300 },
            byCommentId: {
              get: ({ params }: CommentParams) => {
                api.detail(params.comment_id)
                if (api.detailFails) throw networkError()
                if (api.detailsPending) return pendingResponse()
                return responseCopy(server.current.details[params.comment_id]!)
              },
              put: async (input: CommentParams) =>
                (await api.update(input)) ?? { id: input.params.comment_id, updated_at: 300 },
              delete: async (input: unknown) => {
                await api.remove(input)
              },
              resolve: {
                post: async (input: CommentParams) =>
                  (await api.resolve(input)) ?? { id: input.params.comment_id, resolved: true },
              },
              replies: {
                post: async (input: unknown) =>
                  (await api.reply(input)) ?? { id: 'created-reply', created_at: 300 },
                byReplyId: {
                  put: async (input: { params: { reply_id: string } }) =>
                    (await api.updateReply(input)) ?? {
                      id: input.params.reply_id,
                      updated_at: 300,
                    },
                },
              },
            },
          },
        },
      },
    },
  },
})

export const fakeCollaborationManager = {
  onCommentsUpdate: (handler: () => void) => {
    collaboration.handler = handler
    return () => {}
  },
  emitCommentsUpdate: collaboration.emit,
  setNodes: () => {},
  setEdges: () => {},
  canApplyLocalGraphMutation: () => true,
  getCurrentAppId: () => null,
  // Mirrors the real manager: the callback runs immediately with the
  // current readiness and returns an unsubscribe function.
  onGraphReadyChange: (callback: (isReady: boolean) => void) => {
    callback(true)
    return () => {}
  },
}

export function resetFakeServer() {
  for (const spy of [
    api.create,
    api.update,
    api.remove,
    api.resolve,
    api.reply,
    api.updateReply,
    api.detail,
    collaboration.emit,
  ])
    spy.mockReset()
  api.detailFails = false
  api.listGate = undefined
  api.detailsPending = false
  avatar.url = undefined
  collaboration.handler = undefined
  setServer(listItem('first', 'First thread', 100), listItem('second', 'Second thread', 700))
}

// A request that finishes when the test says so. The UI updates optimistically, so a test can
// settle it before the request reaches the fake handler that awaits it; a rejection then has no
// handler yet and Chromium reports it as unhandled. Mark it handled up front; the handler still
// receives the rejection when the request arrives.
export const deferred = <T>() => {
  let settle!: { resolve: (value: T) => void; reject: (error: Error) => void }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  promise.catch(() => {})
  return { promise, ...settle }
}
