import { page, userEvent } from 'vite-plus/test/browser'
import {
  markers,
  openThread,
  pointerToEmptyCanvas,
  renderLayer,
  replyBox,
  thread,
} from './comment-layer-browser-env'
import {
  api,
  deferred,
  listItem,
  resetFakeServer,
  saveReplyOnServer,
  server,
} from './comment-layer-fake-server'

// Markers, the composer, hover previews and keyboard focus on a real canvas.

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

describe('markers and the composer', () => {
  it('switches the thread in place when other comments are opened from their hover cards', async () => {
    const screen = await renderLayer()
    await openThread(screen)
    let closedOnTheWay = false
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[role="dialog"]')) closedOnTheWay = true
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Hovering a marker covers it with its preview card, so the click lands on the card.
    for (const index of [1, 0, 1]) {
      await markers(screen).nth(index).hover()
      await screen
        .getByText(index === 1 ? 'Second thread' : 'First thread')
        .first()
        .click()
    }
    await expect.element(thread(screen)).toMatchTextContent(/Second thread/)
    observer.disconnect()
    expect(closedOnTheWay).toBe(false)
  })

  it('returns a marker to its place when moving it fails, keeping its thread', async () => {
    saveReplyOnServer('first', 'Written meanwhile')
    const move = deferred<never>()
    api.update.mockReturnValueOnce(move.promise)
    const screen = await renderLayer()
    await openThread(screen)
    await expect.element(thread(screen).getByText('Written meanwhile')).toBeVisible()
    const marker = markers(screen).first()
    await userEvent.keyboard('{Escape}')
    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.element(marker).toHaveFocus()
    const before = marker.element().getBoundingClientRect()

    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Tab}')
    await expect.poll(() => marker.element().getBoundingClientRect().x).toBe(before.x + 5)

    move.reject(new Error('Network error'))
    await expect.poll(() => marker.element().getBoundingClientRect().x).toBe(before.x)
    await openThread(screen)
    await expect.element(thread(screen).getByText('Written meanwhile')).toBeVisible()
  })

  it('keeps a new comment’s text until it is created, then shows its marker', async () => {
    const create = deferred<{ id: string; created_at: number }>()
    api.create.mockReturnValueOnce(create.promise)
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store
      .getState()
      .setPendingComment({ pageX: 600, pageY: 400, elementX: 600, elementY: 400 })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')

    await composer.fill('New thread')
    await userEvent.keyboard('{Enter}')
    await expect.element(composer).toHaveAttribute('readonly')
    await expect.element(composer).toHaveValue('New thread')

    server.current.list.push(listItem('new', 'New thread', 600, 400))
    create.resolve({ id: 'new', created_at: 200 })
    await expect.element(composer).not.toBeInTheDocument()
    await expect.poll(() => markers(screen).elements().length).toBe(3)
  })

  it('keeps a new comment’s text to send again when creating it fails', async () => {
    api.create.mockRejectedValueOnce(new Error('Network error'))
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store
      .getState()
      .setPendingComment({ pageX: 600, pageY: 400, elementX: 600, elementY: 400 })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')

    await composer.fill('Not created')
    await userEvent.keyboard('{Enter}')

    await expect.element(composer).not.toHaveAttribute('readonly')
    await expect.element(composer).toHaveValue('Not created')
  })

  it('follows the pointer while a draft comment is dragged', async () => {
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store
      .getState()
      .setPendingComment({ pageX: 300, pageY: 300, elementX: 300, elementY: 300 })
    const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    await expect.element(handle).toBeVisible()
    const start = handle.element().getBoundingClientRect()

    // Several moves in one drag: each must keep the drag going.
    await userEvent.dragAndDrop(
      handle,
      page.elementLocator(document.getElementById('workflow-container')!),
      {
        sourcePosition: { x: 5, y: 5 },
        targetPosition: { x: 700, y: 500 },
        steps: 6,
      } as Parameters<typeof userEvent.dragAndDrop>[2],
    )

    const end = handle.element().getBoundingClientRect()
    expect(end.x - start.x).toBeGreaterThan(350)
    expect(end.y - start.y).toBeGreaterThan(150)
  })
})

describe('keyboard and hover', () => {
  it('previews a comment while hovered and on keyboard focus, and Escape dismisses it until the pointer leaves', async () => {
    const screen = await renderLayer()
    const preview = screen.getByText('First thread')

    await markers(screen).first().hover()
    await expect.element(preview).toBeVisible()
    await pointerToEmptyCanvas()
    await expect.element(preview).not.toBeInTheDocument()

    await markers(screen).first().hover()
    await expect.element(preview).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(preview).not.toBeInTheDocument()
    // The card covers the marker; the pointer still over either does not bring it back.
    await markers(screen)
      .first()
      .hover({ position: { x: 20, y: 20 } })
    await expect.element(preview).not.toBeInTheDocument()
    await pointerToEmptyCanvas()
    await markers(screen).first().hover()
    await expect.element(preview).toBeVisible()

    await pointerToEmptyCanvas()
    await userEvent.tab()
    await expect.element(markers(screen).first()).toHaveFocus()
    await expect.element(preview).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(preview).not.toBeInTheDocument()
  })

  it('opens from the keyboard and gives focus back to its marker, which still moves with the arrow keys', async () => {
    api.update.mockResolvedValue({})
    const screen = await renderLayer()
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await expect.element(replyBox(screen)).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.element(markers(screen).first()).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Tab}')
    await expect.poll(() => api.update.mock.calls.length).toBe(1)
  })

  it('keeps focus on Next as it moves the thread, and gives focus to the comment shown last on close', async () => {
    const screen = await renderLayer()
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await expect.element(replyBox(screen)).toHaveFocus()
    const next = thread(screen).getByRole('button', {
      name: 'workflowComments.comments.aria.nextComment',
    })

    next.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(thread(screen)).toMatchTextContent(/Second thread/)
    await expect.element(next).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.element(markers(screen).nth(1)).toHaveFocus()
  })

  it('closes from the keyboard after comment markers were hidden', async () => {
    const screen = await renderLayer()
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await expect.element(replyBox(screen)).toHaveFocus()

    screen.store.getState().setShowUserComments(false)
    await userEvent.keyboard('{Escape}')

    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.poll(() => markers(screen).elements().length).toBe(0)
  })
})
