import { userEvent } from 'vite-plus/test/browser'
import { trackEvent } from '@/app/components/base/amplitude'
import { TEST_APP_ID } from '@/test/console/ids'
import { networkError, setupFakeApi } from '@/test/fake-api'
import { markers, openThread, renderLayer, sendReply, thread } from './comment-layer-browser-env'
import { api, author, commentLayerApi, resetFakeServer, server } from './comment-layer-fake-server'

// boundary: collaboration runs over a socket to other editors
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', async () => ({
  collaborationManager: (await import('./comment-layer-fake-server')).fakeCollaborationManager,
}))

// boundary: collaboration analytics stop at the telemetry adapter.
vi.mock('@/app/components/base/amplitude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude')>()),
  trackEvent: vi.fn(),
}))

setupFakeApi(commentLayerApi)
beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
  resetFakeServer()
})

const sentComments = () =>
  vi
    .mocked(trackEvent)
    .mock.calls.filter(([event]) => event === 'collab_comment_sent')
    .map(([, properties]) => properties)

const sent = { workspace_id: expect.any(String), app_id: TEST_APP_ID }

it('counts a new thread once it is created, and not when creating it fails', async () => {
  api.create.mockRejectedValueOnce(networkError())
  const screen = await renderLayer()
  await expect.element(markers(screen).first()).toBeVisible()
  screen.store.getState().setPendingComment({ x: 600, y: 400 })
  const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')

  await composer.fill('New thread')
  await userEvent.keyboard('{Enter}')
  await expect.element(composer).not.toHaveAttribute('readonly')
  expect(sentComments()).toEqual([])

  api.create.mockResolvedValueOnce({ id: 'new', created_at: 200 })
  await userEvent.keyboard('{Enter}')
  await expect.element(composer).not.toBeInTheDocument()
  expect(sentComments()).toEqual([
    { ...sent, thread_id: 'new', comment_id: 'new', comment_kind: 'thread' },
  ])
})

it('counts a reply with whether its sender started the thread', async () => {
  const other = { ...author, id: 'other' }
  server.current.list[1] = { ...server.current.list[1]!, created_by: other.id }
  server.current.details.second = { ...server.current.details.second!, created_by: other.id }
  api.reply
    .mockResolvedValueOnce({ id: 'own-reply', created_at: 300 })
    .mockResolvedValueOnce({ id: 'other-reply', created_at: 301 })
  const screen = await renderLayer()

  await openThread(screen, 0)
  await sendReply(screen, 'On my thread')
  await expect.poll(() => sentComments()).toHaveLength(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(thread(screen)).not.toBeInTheDocument()

  await openThread(screen, 1)
  await sendReply(screen, 'On theirs')
  await expect.poll(() => sentComments()).toHaveLength(2)

  expect(sentComments()).toEqual([
    {
      ...sent,
      thread_id: 'first',
      comment_id: 'own-reply',
      comment_kind: 'reply',
      is_thread_author: true,
    },
    {
      ...sent,
      thread_id: 'second',
      comment_id: 'other-reply',
      comment_kind: 'reply',
      is_thread_author: false,
    },
  ])
})
