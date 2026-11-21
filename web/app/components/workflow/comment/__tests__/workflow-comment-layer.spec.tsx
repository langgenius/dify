import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowCommentLayer } from '../workflow-comment-layer'
import { seedMentionableUsers } from './comment-query-data'

const api = vi.hoisted(() => ({
  comments: vi.fn(),
  comment: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  reply: vi.fn(),
}))
const collaboration = vi.hoisted(() => ({
  handler: undefined as undefined | (() => void),
  emit: vi.fn(),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: () => 'just now' }),
}))
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onCommentsUpdate: (handler: () => void) => {
      collaboration.handler = handler
      return () => {}
    },
    emitCommentsUpdate: collaboration.emit,
  },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflow.comments.get': (input: unknown) => api.comments(input),
      'apps.byAppId.workflow.comments.post': (input: unknown) => api.create(input),
      'apps.byAppId.workflow.comments.mentionUsers.get': async () => ({ users: [] }),
      'apps.byAppId.workflow.comments.byCommentId.get': (input: unknown) => api.comment(input),
      'apps.byAppId.workflow.comments.byCommentId.put': (input: unknown) => api.update(input),
      'apps.byAppId.workflow.comments.byCommentId.delete': (input: unknown) => api.remove(input),
      'apps.byAppId.workflow.comments.byCommentId.resolve.post': (input: unknown) =>
        api.resolve(input),
      'apps.byAppId.workflow.comments.byCommentId.replies.post': (input: unknown) =>
        api.reply(input),
    }),
  }
})

const author = { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: null }
const listItem = (id: string, content: string): WorkflowCommentBasic => ({
  id,
  position_x: 10,
  position_y: 20,
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

// The server's comments; handlers read and change them like the backend would.
let server: { list: WorkflowCommentBasic[]; details: Record<string, WorkflowCommentDetail> }
const setServer = (...items: WorkflowCommentBasic[]) => {
  server = {
    list: items,
    details: Object.fromEntries(
      items.map((item) => [item.id, { ...item, replies: [], mentions: [] }]),
    ),
  }
}

const renderLayer = () => {
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(queryClient, { id: author.id, name: author.name })
  seedSystemFeatures(queryClient)
  seedMentionableUsers(queryClient, [])
  const result = renderWorkflowFlowComponent(
    <div id="workflow-container">
      <WorkflowCommentLayer />
    </div>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true },
      initialStoreState: { showUserComments: true },
    },
  )
  return { ...result, queryClient }
}

const openThread = async (name = author.name) => {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: `workflow.keyboard.openComment:{"name":"${name}"}` }),
  )
  const thread = await screen.findByRole('dialog', { name: 'workflowComments.comments.panelTitle' })
  return { user, thread }
}

const sendReply = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByPlaceholderText('workflowComments.comments.placeholder.reply'), text)
  await user.keyboard('{Enter}')
}

const saveReplyOnServer = (content: string, id = 'reply-1') => {
  server.details['comment-1']!.replies.push({
    id,
    content,
    created_at: Math.floor(Date.now() / 1000),
    created_by: author.id,
    created_by_account: author,
  })
  return { id, created_at: Math.floor(Date.now() / 1000) }
}

beforeEach(() => {
  vi.clearAllMocks()
  collaboration.handler = undefined
  setServer(listItem('comment-1', 'First thread'))
  api.comments.mockImplementation(async () => ({ data: server.list.map((item) => ({ ...item })) }))
  api.comment.mockImplementation(async ({ params }: { params: { comment_id: string } }) =>
    structuredClone(server.details[params.comment_id]),
  )
})

describe('WorkflowCommentLayer', () => {
  it('shows a reply as soon as it is sent and keeps one row once it is saved', async () => {
    let finishSend!: () => void
    api.reply.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSend = () => resolve(saveReplyOnServer('Looks good'))
        }),
    )
    renderLayer()
    const { user, thread } = await openThread()

    await sendReply(user, 'Looks good')
    const sending = within(thread).getByText('Looks good')
    expect(sending.closest('[aria-busy="true"]')).not.toBeNull()

    await act(async () => finishSend())
    await waitFor(() =>
      expect(within(thread).getByText('Looks good').closest('[aria-busy="true"]')).toBeNull(),
    )
    expect(within(thread).getAllByText('Looks good')).toHaveLength(1)
  })

  it('keeps a reply that failed to send, to send again or to drop', async () => {
    api.reply.mockRejectedValueOnce(new Error('Network error'))
    renderLayer()
    const { user, thread } = await openThread()

    await sendReply(user, 'Try again')
    expect(
      await within(thread).findByText('workflowComments.comments.status.notSent'),
    ).toBeVisible()

    api.reply.mockImplementationOnce(async () => saveReplyOnServer('Try again'))
    await user.click(within(thread).getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() =>
      expect(within(thread).queryByText('workflowComments.comments.status.notSent')).toBeNull(),
    )
    expect(api.reply).toHaveBeenCalledTimes(2)
    expect(api.reply).toHaveBeenLastCalledWith({
      params: { app_id: 'app-1', comment_id: 'comment-1' },
      body: { content: 'Try again', mentioned_user_ids: [] },
    })
    expect(within(thread).getAllByText('Try again')).toHaveLength(1)

    api.reply.mockRejectedValueOnce(new Error('Network error'))
    await sendReply(user, 'Drop me')
    await within(thread).findByText('workflowComments.comments.status.notSent')
    await user.click(within(thread).getByRole('button', { name: 'common.operation.delete' }))
    expect(within(thread).queryByText('Drop me')).toBeNull()
  })

  it('does not offer to resend a reply the server saved although its send failed', async () => {
    // Saved, but the response was lost.
    api.reply.mockImplementationOnce(async () => {
      saveReplyOnServer('Saved anyway')
      throw new Error('Network error')
    })
    renderLayer()
    const { user, thread } = await openThread()

    await sendReply(user, 'Saved anyway')

    // The refetch after the failed send shows the server has it, so it is not offered again.
    await waitFor(() =>
      expect(within(thread).queryByText('workflowComments.comments.status.notSent')).toBeNull(),
    )
    expect(api.reply).toHaveBeenCalledTimes(1)
    expect(within(thread).getAllByText('Saved anyway')).toHaveLength(1)
  })

  it('looks before resending, and drops a failed reply the server has saved since', async () => {
    api.reply.mockRejectedValueOnce(new Error('Network error'))
    renderLayer()
    const { user, thread } = await openThread()

    await sendReply(user, 'Saved later')
    const retry = await within(thread).findByRole('button', { name: 'common.operation.retry' })
    saveReplyOnServer('Saved later')
    await user.click(retry)

    await waitFor(() =>
      expect(within(thread).queryByText('workflowComments.comments.status.notSent')).toBeNull(),
    )
    expect(api.reply).toHaveBeenCalledTimes(1)
    expect(within(thread).getAllByText('Saved later')).toHaveLength(1)
  })

  it('shows a resolve at once and puts it back when it fails', async () => {
    let failResolve!: () => void
    api.resolve.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failResolve = () => reject(new Error('Network error'))
        }),
    )
    renderLayer()
    const { user, thread } = await openThread()
    const resolve = within(thread).getByRole('button', {
      name: 'workflowComments.comments.aria.resolveComment',
    })

    await user.click(resolve)
    await waitFor(() => expect(resolve).toBeDisabled())
    // The thread stays open until the server has the resolve.
    expect(thread).toBeInTheDocument()

    await act(async () => failResolve())
    await waitFor(() => expect(resolve).toBeEnabled())
  })

  it('puts back only the position when moving a marker fails', async () => {
    server.details['comment-1']!.replies.push({
      id: 'reply-1',
      content: 'Written meanwhile',
      created_by: author.id,
      created_by_account: author,
      created_at: 100,
    })
    api.update.mockRejectedValue(new Error('Network error'))
    const { queryClient } = renderLayer()
    const { thread } = await openThread()
    await within(thread).findByText('Written meanwhile')
    const marker = screen.getByRole('button', {
      name: `workflow.keyboard.openComment:{"name":"${author.name}"}`,
    })
    const user = userEvent.setup()

    marker.focus()
    await user.keyboard('{ArrowRight}')
    act(() => marker.blur())

    await waitFor(() => expect(api.update).toHaveBeenCalled())
    const params = { app_id: 'app-1', comment_id: 'comment-1' }
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
            input: { params: { app_id: 'app-1' } },
          }),
        )?.data[0]?.position_x,
      ).toBe(10),
    )
    expect(
      queryClient
        .getQueryData(
          consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
            input: { params },
          }),
        )
        ?.replies.map((reply) => reply.content),
    ).toEqual(['Written meanwhile'])
  })

  it('just closes a deleted thread instead of opening another', async () => {
    setServer(listItem('comment-1', 'First thread'), listItem('comment-2', 'Second thread'))
    api.remove.mockImplementation(async ({ params }: { params: { comment_id: string } }) => {
      server.list = server.list.filter((item) => item.id !== params.comment_id)
      return { result: 'success' }
    })
    const { store } = renderLayer()
    const user = userEvent.setup()
    await user.click(
      (
        await screen.findAllByRole('button', {
          name: `workflow.keyboard.openComment:{"name":"${author.name}"}`,
        })
      )[0]!,
    )
    const thread = await screen.findByRole('dialog', {
      name: 'workflowComments.comments.panelTitle',
    })
    expect(thread).toHaveTextContent('First thread')

    await user.click(
      within(thread).getByRole('button', { name: 'workflowComments.comments.aria.deleteComment' }),
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.delete',
      }),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'workflowComments.comments.panelTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(store.getState().activeCommentId).toBeNull()
    expect(api.comment).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ comment_id: 'comment-2' }) }),
    )
  })

  it('refetches on a collaborator’s change, but not while a write from here is running', async () => {
    let finishSend!: () => void
    api.reply.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSend = () => resolve(saveReplyOnServer('Mine'))
        }),
    )
    renderLayer()
    const { user } = await openThread()
    const listFetches = () => api.comments.mock.calls.length

    const before = listFetches()
    await act(async () => collaboration.handler?.())
    await waitFor(() => expect(listFetches()).toBe(before + 1))

    await sendReply(user, 'Mine')
    const duringWrite = listFetches()
    await act(async () => collaboration.handler?.())
    expect(listFetches()).toBe(duringWrite)

    // The write reconciles once it settles.
    await act(async () => finishSend())
    await waitFor(() => expect(listFetches()).toBe(duringWrite + 1))
  })

  it('keeps the new comment’s text until it is created, and after a failure', async () => {
    let finishCreate!: () => void
    api.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = () => {
            server.list.push(listItem('comment-new', 'New thread'))
            resolve({ id: 'comment-new', created_at: 200 })
          }
        }),
    )
    const { store } = renderLayer()
    await screen.findByRole('button', { name: /workflow.keyboard.openComment/ })
    act(() =>
      store.setState({ pendingComment: { pageX: 10, pageY: 10, elementX: 10, elementY: 10 } }),
    )
    const user = userEvent.setup()
    const composer = await screen.findByPlaceholderText('workflowComments.comments.placeholder.add')

    await user.type(composer, 'New thread')
    await user.keyboard('{Enter}')
    expect(composer).toHaveValue('New thread')
    expect(composer).toHaveAttribute('readonly')

    await act(async () => finishCreate())
    await waitFor(() => expect(store.getState().pendingComment).toBeNull())
    expect(
      await screen.findAllByRole('button', { name: /workflow.keyboard.openComment/ }),
    ).toHaveLength(2)

    api.create.mockRejectedValueOnce(new Error('Network error'))
    act(() =>
      store.setState({ pendingComment: { pageX: 10, pageY: 10, elementX: 10, elementY: 10 } }),
    )
    const retryComposer = await screen.findByPlaceholderText(
      'workflowComments.comments.placeholder.add',
    )
    await user.type(retryComposer, 'Not created')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(retryComposer).not.toHaveAttribute('readonly'))
    expect(retryComposer).toHaveValue('Not created')
    expect(store.getState().pendingComment).not.toBeNull()
  })
})
