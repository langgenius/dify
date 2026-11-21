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
  detailFails: false,
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
    const data = server.current.list.map((item) => ({ ...item }))
    await api.listGate
    return { data }
  },
  'apps.byAppId.workflow.comments.mentionUsers.get': async () => ({ users: [] }),
  'apps.byAppId.workflow.comments.byCommentId.get': async ({
    params,
  }: {
    params: { comment_id: string }
  }) => {
    if (api.detailFails) throw new Error('Network error')
    return structuredClone(server.current.details[params.comment_id])
  },
  'apps.byAppId.workflow.comments.post': (input: unknown) => api.create(input),
  'apps.byAppId.workflow.comments.byCommentId.put': (input: unknown) => api.update(input),
  'apps.byAppId.workflow.comments.byCommentId.delete': (input: unknown) => api.remove(input),
  'apps.byAppId.workflow.comments.byCommentId.resolve.post': (input: unknown) => api.resolve(input),
  'apps.byAppId.workflow.comments.byCommentId.replies.post': (input: unknown) => api.reply(input),
}

export const fakeCollaborationManager = {
  onCommentsUpdate: (handler: () => void) => {
    collaboration.handler = handler
    return () => {}
  },
  emitCommentsUpdate: collaboration.emit,
}

export function resetFakeServer() {
  vi.clearAllMocks()
  api.detailFails = false
  api.listGate = undefined
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
