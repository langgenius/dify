import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { networkError, setupFakeApi } from '@/test/fake-api'
import { ControlMode } from '../../types'
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
  avatar,
  commentLayerApi,
  deferred,
  listItem,
  resetFakeServer,
  saveReplyOnServer,
  server,
} from './comment-layer-fake-server'

// Markers, the composer, hover previews and keyboard focus on a real canvas.

// boundary: collaboration runs over a socket to other editors
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', async () => ({
  collaborationManager: (await import('./comment-layer-fake-server')).fakeCollaborationManager,
}))

setupFakeApi(commentLayerApi)
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

    await expect
      .poll(() => api.update.mock.calls[0]?.[0])
      .toMatchObject({ params: { comment_id: 'first' } })
    move.reject(networkError())
    await expect.poll(() => marker.element().getBoundingClientRect().x).toBe(before.x)
    await openThread(screen)
    await expect.element(thread(screen).getByText('Written meanwhile')).toBeVisible()
  })

  it('leaves a dragged marker where it was dropped, without going back on the way', async () => {
    api.update.mockImplementation(
      async ({ params, body }: { params: { comment_id: string }; body: WorkflowCommentBasic }) => {
        const saved = server.current.list.find((item) => item.id === params.comment_id)!
        Object.assign(saved, { position_x: body.position_x, position_y: body.position_y })
        return { id: params.comment_id, updated_at: 200 }
      },
    )
    const screen = await renderLayer()
    const marker = markers(screen).first()
    await expect.element(marker).toBeVisible()
    const start = marker.element().getBoundingClientRect().x

    // Every position the marker takes from the drag on.
    const positions: number[] = []
    const watch = new MutationObserver(() => {
      positions.push(marker.element().getBoundingClientRect().x)
    })
    watch.observe(marker.element(), { attributes: true, attributeFilter: ['style'] })
    // Pointing at the marker opens its hover card over it; the drag starts on the card.
    await marker.hover()
    await userEvent.dragAndDrop(
      screen.getByText('First thread'),
      page.elementLocator(document.getElementById('workflow-container')!),
      {
        sourcePosition: { x: 10, y: 10 },
        targetPosition: { x: 600, y: 300 },
        steps: 6,
      } as Parameters<typeof userEvent.dragAndDrop>[2],
    )
    await expect.poll(() => api.update.mock.calls.length).toBe(1)
    await expect.poll(() => marker.element().getBoundingClientRect().x).toBeGreaterThan(start + 200)
    watch.disconnect()

    const moved = positions.findIndex((x) => x > start + 200)
    expect(moved).toBeGreaterThanOrEqual(0)
    expect(positions.slice(moved).every((x) => x > start + 200)).toBe(true)
  })

  it('keeps a new comment’s text until it is created, then shows its marker', async () => {
    const create = deferred<{ id: string; created_at: number }>()
    api.create.mockReturnValueOnce(create.promise)
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store.getState().setPendingComment({ x: 600, y: 400 })
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

  it('keeps a new comment’s draft when Escape ends an input method composition, in Safari’s event order', async () => {
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store.getState().setPendingComment({ x: 600, y: 400 })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')
    await composer.fill('草稿')
    const box = composer.element()

    // Safari reports the composition as ended before the key that cancels it.
    box.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )

    await expect.element(composer).toHaveValue('草稿')
  })

  it('keeps a new comment’s text to send again when creating it fails', async () => {
    api.create.mockRejectedValueOnce(networkError())
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store.getState().setPendingComment({ x: 600, y: 400 })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')

    await composer.fill('Not created')
    await userEvent.keyboard('{Enter}')

    await expect.element(composer).not.toHaveAttribute('readonly')
    await expect.element(composer).toHaveValue('Not created')
  })

  it('places a new comment’s input beside its marker as the design does', async () => {
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store.getState().setPendingComment({ x: 300, y: 300 })
    const marker = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    const input = screen.getByRole('dialog', { name: 'workflowComments.comments.placeholder.add' })
    await expect.element(input).toBeVisible()

    // 12px to the right of the 27px marker, top 6.5px above the marker's (to the device pixel).
    const gaps = () => {
      const markerBox = marker.element().getBoundingClientRect()
      const inputBox = input.element().getBoundingClientRect()
      return { side: inputBox.left - markerBox.right, top: inputBox.top - markerBox.top }
    }
    await expect.poll(() => gaps().side).toBe(12)
    expect(Math.abs(gaps().top + 6.5)).toBeLessThanOrEqual(0.5)
  })

  it('follows the pointer while a draft comment is dragged', async () => {
    const screen = await renderLayer()
    await expect.element(markers(screen).first()).toBeVisible()
    screen.store.getState().setPendingComment({ x: 300, y: 300 })
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

describe('panning the canvas', () => {
  const canvas = () => document.getElementById('workflow-container')!.getBoundingClientRect()
  const inCanvas = (element: Element) => {
    const box = element.getBoundingClientRect()
    const bounds = canvas()
    return box.left >= bounds.left && box.right <= bounds.right
  }

  it('keeps a draft editable at its original canvas position after scrolling its marker out of view', async () => {
    const screen = await renderLayer({ controlMode: ControlMode.Comment })
    await expect.element(markers(screen).first()).toBeVisible()
    const pane = page.elementLocator(document.querySelector('.react-flow__pane')!)
    await pane.click({ position: { x: 600, y: 300 } })
    const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')
    await composer.fill('Placed here')
    await pane.wheel({ delta: { x: 1600, y: 0 } })

    await expect
      .poll(() => handle.element().getBoundingClientRect().right)
      .toBeLessThan(canvas().left)
    await expect.element(composer).toBeVisible()
    expect(inCanvas(composer.element())).toBe(true)
    await expect.element(composer).toHaveFocus()
    await userEvent.keyboard(' after panning')
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => api.create.mock.calls[0]?.[0])
      .toMatchObject({
        body: { position_x: 600, position_y: 300, content: 'Placed here after panning' },
      })
  })

  it('keeps a new comment’s input clear of the side panel on the side it sits in right-to-left layouts', async () => {
    const screen = await renderLayer({ direction: 'rtl' })
    await expect.element(markers(screen).first()).toBeVisible()
    // In right-to-left layouts the side panel sits at the canvas's left edge.
    screen.store.getState().setRightPanelWidth(400)
    screen.store.getState().setPendingComment({ x: 1000, y: 300 })
    const composer = screen.getByPlaceholder('workflowComments.comments.placeholder.add')
    await expect.element(composer).toBeVisible()

    await expect
      .poll(() => composer.element().getBoundingClientRect().left)
      .toBeGreaterThanOrEqual(canvas().left + 400)
  })

  it('keeps an open thread in view and in use once its marker is panned out of view', async () => {
    const screen = await renderLayer()
    await openThread(screen)

    const pane = page.elementLocator(document.querySelector('.react-flow__pane')!)
    await pane.wheel({ delta: { x: 600, y: 0 } })

    await expect
      .poll(() => markers(screen).first().element().getBoundingClientRect().right)
      .toBeLessThan(canvas().left)
    await expect.element(thread(screen)).toBeVisible()
    expect(inCanvas(thread(screen).element())).toBe(true)
    await expect.element(replyBox(screen)).toBeEnabled()
    await replyBox(screen).fill('Still here')
    await expect.element(replyBox(screen)).toHaveValue('Still here')
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
    await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('link', { name: 'React Flow attribution' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(markers(screen).first()).toHaveFocus()
    await expect.element(preview).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(preview).not.toBeInTheDocument()
  })

  it('puts focus in a reply’s edit field, at the end of its text, when Edit is chosen', async () => {
    saveReplyOnServer('first', 'A reply to edit', 'reply-edit')
    const screen = await renderLayer()
    await openThread(screen)

    await thread(screen).getByLabelText('workflowComments.comments.aria.replyActions').click()
    await screen
      .getByRole('menuitem', { name: 'workflowComments.comments.actions.editReply' })
      .click()

    const editor = screen.getByPlaceholder('workflowComments.comments.placeholder.editReply')
    await expect.element(editor).toHaveFocus()
    const field = editor.element() as HTMLTextAreaElement
    expect(field.selectionStart).toBe('A reply to edit'.length)
    expect(field.selectionEnd).toBe('A reply to edit'.length)
  })

  it('opens from the keyboard and gives focus back to its marker, which still moves with the arrow keys', async () => {
    const screen = await renderLayer()
    await openThread(screen)
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
    await openThread(screen)
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
    await openThread(screen)
    await expect.element(replyBox(screen)).toHaveFocus()

    screen.store.getState().setShowUserComments(false)
    await userEvent.keyboard('{Escape}')

    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.poll(() => markers(screen).elements().length).toBe(0)
  })
})

describe('avatars', () => {
  it('shows an avatar already shown on the canvas at once in a thread that opens', async () => {
    const avatarUrl = '/logo/logo-embedded-chat-avatar.png'
    avatar.url = avatarUrl
    saveReplyOnServer('first', 'With a picture', 'reply-picture')
    // Profile, list and detail responses all identify the same avatar with the same stable URL.
    const screen = await renderLayer({ avatarUrl })
    const markerPicture = () => markers(screen).first().element().querySelector('img')
    await expect
      .poll(() => markerPicture()?.complete && markerPicture()!.naturalWidth > 0)
      .toBe(true)

    // Opening the thread must reuse the loaded picture without showing the initials meanwhile.
    let fellBack = false
    const watch = new MutationObserver(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog && [...dialog.querySelectorAll('span')].some((el) => el.textContent === 'A'))
        fellBack = true
    })
    watch.observe(document.body, { subtree: true, childList: true, characterData: true })
    await openThread(screen)
    await expect.element(thread(screen).getByText('With a picture')).toBeVisible()
    watch.disconnect()

    expect(fellBack).toBe(false)
  })
})
