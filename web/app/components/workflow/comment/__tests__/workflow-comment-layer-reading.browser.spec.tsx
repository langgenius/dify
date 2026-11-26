import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { TEST_APP_ID } from '@/test/console/ids'
import { networkError, setupFakeApi } from '@/test/fake-api'
import { markers, openThread, renderLayer, sendReply, thread } from './comment-layer-browser-env'
import {
  api,
  collaboration,
  commentLayerApi,
  deferred,
  listItem,
  resetFakeServer,
  saveReplyOnServer,
  server,
} from './comment-layer-fake-server'

// Where a thread's message list sits as replies arrive: a reader of earlier messages keeps
// their place, and replies sent from here or arriving at the newest message come into view.

// boundary: collaboration runs over a socket to other editors
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', async () => ({
  collaborationManager: (await import('./comment-layer-fake-server')).fakeCollaborationManager,
}))

setupFakeApi(commentLayerApi)
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
    api.reply.mockRejectedValueOnce(networkError())
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

  it('keeps the reader’s place when one of several sends finishes', async () => {
    for (let index = 0; index < 12; index++)
      saveReplyOnServer('first', `Reply number ${index}`, `reply-${index}`)
    const first = deferred<{ id: string; created_at: number }>()
    const second = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const screen = await renderLayer()
    await openThread(screen)
    await sendReply(screen, 'Sending first')
    await sendReply(screen, 'Sending second')
    await expect.element(thread(screen).getByText('Sending second')).toBeInViewport()

    await userEvent.wheel(thread(screen).getByText('Sending second'), {
      direction: 'up',
      times: 10,
    })
    const oldest = thread(screen).getByText('Reply number 0')
    await expect.element(oldest).toBeInViewport()
    const list = scrollingParent(oldest.element())
    const readingAt = list.scrollTop
    second.resolve(saveReplyOnServer('first', 'Sending second'))
    await expect
      .poll(() =>
        thread(screen).getByText('Sending second').element().closest('[aria-busy="true"]'),
      )
      .toBeNull()
    await nextFrames(2)

    expect(list.scrollTop).toBe(readingAt)
    first.resolve(saveReplyOnServer('first', 'Sending first'))
  })

  it('brings a failed reply into view when it is sent again', async () => {
    const failures = ['Failure 1', 'Failure 2', 'Failure 3', 'Failure 4', 'Failure 5', 'Failure 6']
    for (const _ of failures) api.reply.mockRejectedValueOnce(networkError())
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

describe('opening a thread with its replies', () => {
  type Screen = Awaited<ReturnType<typeof renderLayer>>
  const threadIsRead = (screen: Screen, commentId: string) =>
    expect
      .poll(
        () =>
          screen.queryClient.getQueryState(
            consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
              input: { params: { app_id: TEST_APP_ID, comment_id: commentId } },
            }),
          )?.status,
      )
      .toBe('success')
  // From here on a thread's own read never answers, so what it shows was read ahead.
  const holdThreadReads = () => {
    api.detailsPending = true
  }

  it('shows a thread’s replies at once when it opens after its marker was hovered', async () => {
    saveReplyOnServer('first', 'Read ahead on hover', 'reply-hover')
    const screen = await renderLayer()
    await markers(screen).first().hover()
    await threadIsRead(screen, 'first')
    holdThreadReads()

    await openThread(screen)

    await expect.element(thread(screen).getByText('Read ahead on hover')).toBeVisible()
  })

  it('shows the next thread’s replies at once when stepping to it', async () => {
    saveReplyOnServer('second', 'Read ahead as a neighbor', 'reply-neighbor')
    const screen = await renderLayer()
    await openThread(screen)
    await threadIsRead(screen, 'second')
    holdThreadReads()

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
      .click()

    await expect.element(thread(screen)).toMatchTextContent(/Second thread/)
    await expect.element(thread(screen).getByText('Read ahead as a neighbor')).toBeVisible()
  })

  it('reads the new neighbor ahead when a collaborator’s change moves it next to the open thread', async () => {
    server.current.list.push(listItem('third', 'Third thread', 400, 400))
    server.current.details.third = { ...server.current.list[2]!, replies: [], mentions: [] }
    const screen = await renderLayer({ hideResolved: true })
    await openThread(screen)
    await threadIsRead(screen, 'second')
    expect(api.detail).not.toHaveBeenCalledWith('third')

    server.current.list[1]!.resolved = true
    collaboration.handler?.()

    await threadIsRead(screen, 'third')
  })

  it('reads a hovered thread once, however often its marker is hovered', async () => {
    const screen = await renderLayer()
    for (let hover = 0; hover < 3; hover++) {
      await markers(screen).first().hover()
      await threadIsRead(screen, 'first')
      await page.elementLocator(document.querySelector('.react-flow__pane')!).hover({
        position: { x: 1000, y: 600 },
      })
    }

    expect(api.detail.mock.calls.filter(([id]) => id === 'first')).toHaveLength(1)
  })
})
