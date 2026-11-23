import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'

// The server, request handlers and collaboration channel the comment layer browser specs
// stand in for. It imports nothing from the app, so the specs' mocks can load it.

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
  // While set, a thread read answers with the thread as it was when asked, once the gate opens.
  detailGate: undefined as undefined | Promise<unknown>,
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

export const consoleResponses = {
  'apps.byAppId.workflow.comments.get': async () => {
    const data = responseCopy(server.current.list)
    await api.listGate
    return { data }
  },
  'apps.byAppId.workflow.comments.mentionUsers.get': async () => ({ users: [] }),
  'apps.byAppId.workflow.comments.byCommentId.get': async ({
    params,
  }: {
    params: { comment_id: string }
  }) => {
    api.detail(params.comment_id)
    if (api.detailFails) throw new Error('Network error')
    const detail = responseCopy(server.current.details[params.comment_id])
    await api.detailGate
    return detail
  },
  'apps.byAppId.workflow.comments.post': (input: unknown) => api.create(input),
  'apps.byAppId.workflow.comments.byCommentId.put': (input: unknown) => api.update(input),
  'apps.byAppId.workflow.comments.byCommentId.delete': (input: unknown) => api.remove(input),
  'apps.byAppId.workflow.comments.byCommentId.resolve.post': (input: unknown) => api.resolve(input),
  'apps.byAppId.workflow.comments.byCommentId.replies.post': (input: unknown) => api.reply(input),
  'apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.put': (input: unknown) =>
    api.updateReply(input),
}

export const fakeCollaborationManager = {
  onCommentsUpdate: (handler: () => void) => {
    collaboration.handler = handler
    return () => {}
  },
  emitCommentsUpdate: collaboration.emit,
}

export function resetFakeServer() {
  vi.resetAllMocks()
  api.detailFails = false
  api.listGate = undefined
  api.detailGate = undefined
  avatar.url = undefined
  collaboration.handler = undefined
  setServer(listItem('first', 'First thread', 100), listItem('second', 'Second thread', 700))
}

// A request that finishes when the test says so.
export const deferred = <T>() => {
  let settle!: { resolve: (value: T) => void; reject: (error: Error) => void }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return { promise, ...settle }
}
