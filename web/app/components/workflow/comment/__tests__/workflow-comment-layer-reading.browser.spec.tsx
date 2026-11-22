import { userEvent } from 'vite-plus/test/browser'
import { openThread, renderLayer, sendReply, thread } from './comment-layer-browser-env'
import {
  api,
  collaboration,
  deferred,
  resetFakeServer,
  saveReplyOnServer,
} from './comment-layer-fake-server'

// Where a thread's message list sits as replies arrive: a reader of earlier messages keeps
// their place, and replies sent from here or arriving at the newest message come into view.

// boundary: relative times depend on the clock
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: () => 'just now' }),
}))
// boundary: collaboration runs over a socket to other editors
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', async () => ({
  collaborationManager: (await import('./comment-layer-fake-server')).fakeCollaborationManager,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { consoleResponses } = await import('./comment-layer-fake-server')
  return { ...actual, consoleQuery: withConsoleResponses(actual.consoleQuery, consoleResponses) }
})

beforeEach(resetFakeServer)

const scrollingParent = (element: Element) => {
  let parent = element.parentElement
  while (parent && getComputedStyle(parent).overflowY !== 'auto') parent = parent.parentElement
  return parent!
}
const nextFrames = async (count: number) => {
  for (let frame = 0; frame < count; frame++)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}

describe('reading a thread', () => {
  it('opens a long thread on its newest message', async () => {
    for (let index = 0; index < 12; index++)
      saveReplyOnServer('first', `Reply number ${index}`, `reply-${index}`)
    const screen = await renderLayer()
    await openThread(screen)

    await expect.element(thread(screen).getByText('Reply number 11')).toBeInViewport()
    await expect.element(thread(screen).getByText('Reply number 0')).not.toBeInViewport()
  })

  it('keeps the reader’s place when a collaborator replies, and follows when they are at the newest', async () => {
    for (let index = 0; index < 12; index++)
      saveReplyOnServer('first', `Reply number ${index}`, `reply-${index}`)
    api.reply.mockImplementation(async ({ body }: { body: { content: string } }) =>
      saveReplyOnServer('first', body.content),
    )
    const screen = await renderLayer()
    await openThread(screen)
    const oldest = thread(screen).getByText('Reply number 0')

    // Reading earlier messages: a collaborator's reply does not pull the list down.
    await userEvent.wheel(thread(screen).getByText('Reply number 11'), {
      direction: 'up',
      times: 10,
    })
    await expect.element(oldest).toBeInViewport()
    const list = scrollingParent(oldest.element())
    const readingAt = list.scrollTop
    saveReplyOnServer('first', 'From a collaborator')
    collaboration.handler?.()
    await expect.element(thread(screen).getByText('From a collaborator')).toBeInTheDocument()
    // A smooth scroll would have moved the list by the second frame.
    await nextFrames(2)
    expect(list.scrollTop).toBe(readingAt)
    await expect.element(thread(screen).getByText('From a collaborator')).not.toBeInViewport()

    // A reply sent from here always shows.
    await sendReply(screen, 'My own reply')
    await expect.element(thread(screen).getByText('My own reply')).toBeInViewport()

    // At the newest message, collaborator replies come into view, even one arriving while the
    // list is still scrolling to the one before.
    saveReplyOnServer('first', 'Another collaborator reply')
    collaboration.handler?.()
    await expect.element(thread(screen).getByText('Another collaborator reply')).toBeInTheDocument()
    saveReplyOnServer('first', 'And one more')
    collaboration.handler?.()
    await expect.element(thread(screen).getByText('And one more')).toBeInViewport()
  })

  it('keeps the reader’s place when a collaborator replies below a reply that failed to send', async () => {
    for (let index = 0; index < 12; index++)
      saveReplyOnServer('first', `Reply number ${index}`, `reply-${index}`)
    api.reply.mockRejectedValueOnce(new Error('Network error'))
    const screen = await renderLayer()
    await openThread(screen)
    await sendReply(screen, 'Not sent')
    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .toBeVisible()

    const oldest = thread(screen).getByText('Reply number 0')
    await userEvent.wheel(thread(screen).getByText('Reply number 11'), {
      direction: 'up',
      times: 10,
    })
    await expect.element(oldest).toBeInViewport()
    const list = scrollingParent(oldest.element())
    const readingAt = list.scrollTop
    saveReplyOnServer('first', 'From a collaborator')
    collaboration.handler?.()
    await expect.element(thread(screen).getByText('From a collaborator')).toBeInTheDocument()
    await nextFrames(2)
    expect(list.scrollTop).toBe(readingAt)
  })

  it('follows a reply sent while reading earlier messages, and the replies after it', async () => {
    for (let index = 0; index < 12; index++)
      saveReplyOnServer('first', `Reply number ${index}`, `reply-${index}`)
    api.reply.mockImplementation(async ({ body }: { body: { content: string } }) =>
      saveReplyOnServer('first', body.content),
    )
    const screen = await renderLayer()
    await openThread(screen)
    await userEvent.wheel(thread(screen).getByText('Reply number 11'), {
      direction: 'up',
      times: 10,
    })
    await expect.element(thread(screen).getByText('Reply number 0')).toBeInViewport()

    await sendReply(screen, 'Sent while reading')
    // A collaborator replies while the list is still scrolling to the sent reply.
    saveReplyOnServer('first', 'A long collaborator reply '.repeat(8))
    collaboration.handler?.()

    await expect
      .element(thread(screen).getByText(/^A long collaborator reply/))
      .toBeInViewport({ ratio: 1 })
  })

  it('brings a failed reply into view when it is sent again', async () => {
    const failures = ['Failure 1', 'Failure 2', 'Failure 3', 'Failure 4', 'Failure 5', 'Failure 6']
    for (const _ of failures) api.reply.mockRejectedValueOnce(new Error('Network error'))
    const screen = await renderLayer()
    await openThread(screen)
    for (const text of failures) await sendReply(screen, text)
    await expect
      .poll(() => thread(screen).getByText('workflowComments.comments.status.notSent').elements())
      .toHaveLength(failures.length)

    // The reader goes back up to the first failure; the newest messages are out of view.
    await userEvent.wheel(thread(screen).getByText('Failure 6'), { direction: 'up', times: 10 })
    await expect.element(thread(screen).getByText('Failure 1')).toBeInViewport()
    await expect.element(thread(screen).getByText('Failure 6')).not.toBeInViewport()
    const send = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(send.promise)
    await thread(screen).getByRole('button', { name: 'common.operation.retry' }).first().click()

    // Sent again, it moves to the end of the thread, and the list follows it there.
    await expect.element(thread(screen).getByText('Failure 6')).toBeInViewport()
    await expect.element(thread(screen).getByText('Failure 1')).toBeInViewport()
    send.resolve(saveReplyOnServer('first', 'Failure 1'))
  })
})
