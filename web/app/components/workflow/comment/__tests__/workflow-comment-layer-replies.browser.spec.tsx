import { userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { TEST_APP_ID } from '@/test/console/ids'
import { networkError, setupFakeApi } from '@/test/fake-api'
import {
  markers,
  openThread,
  renderLayer,
  replyBox,
  sendReply,
  thread,
} from './comment-layer-browser-env'
import {
  api,
  author,
  collaboration,
  commentLayerApi,
  deferred,
  resetFakeServer,
  saveReplyOnServer,
  server,
} from './comment-layer-fake-server'

// Replies and thread actions against a fake server: optimistic writes, failures and
// reconciliation, asserted by what the thread shows.

// boundary: collaboration runs over a socket to other editors
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', async () => ({
  collaborationManager: (await import('./comment-layer-fake-server')).fakeCollaborationManager,
}))

const OTHER_APP_ID = '019a0000-0000-7000-8000-0000000000a2'
setupFakeApi(commentLayerApi)
beforeEach(resetFakeServer)

describe('replies', () => {
  it('shows a reply as soon as it is sent, then as one saved reply', async () => {
    const send = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(send.promise)
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'Looks good')
    const reply = thread(screen).getByText('Looks good')
    await expect.element(reply).toBeVisible()
    expect(reply.element().closest('[aria-busy="true"]')).not.toBeNull()
    await expect.element(replyBox(screen)).toHaveValue('')

    send.resolve(saveReplyOnServer('first', 'Looks good'))
    await expect.poll(() => reply.element().closest('[aria-busy="true"]')).toBeNull()
    expect(thread(screen).getByText('Looks good').elements()).toHaveLength(1)
  })

  it('keeps both replies when two sends finish out of order', async () => {
    const first = deferred<{ id: string; created_at: number }>()
    const second = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'One')
    await sendReply(screen, 'Two')
    second.resolve(saveReplyOnServer('first', 'Two'))
    first.resolve(saveReplyOnServer('first', 'One'))

    for (const text of ['One', 'Two']) {
      const reply = thread(screen).getByText(text)
      await expect.poll(() => reply.element().closest('[aria-busy="true"]')).toBeNull()
      expect(reply.elements()).toHaveLength(1)
    }
  })

  it('keeps a failed reply to send again, once however often retry is pressed, or to drop', async () => {
    api.reply.mockRejectedValueOnce(networkError())
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'Try again')
    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .toBeVisible()
    api.reply.mockImplementation(async () => saveReplyOnServer('first', 'Try again'))
    await thread(screen).getByRole('button', { name: 'common.operation.retry' }).dblClick()
    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .not.toBeInTheDocument()
    await expect.poll(() => api.reply.mock.results.length).toBe(2)
    expect(thread(screen).getByText('Try again').elements()).toHaveLength(1)

    api.reply.mockRejectedValueOnce(networkError())
    await sendReply(screen, 'Drop me')
    await thread(screen).getByRole('button', { name: 'common.operation.delete' }).click()
    await expect.element(thread(screen).getByText('Drop me')).not.toBeInTheDocument()
  })

  it('shows a reply the server saved although its response was lost beside its failed row', async () => {
    api.reply.mockImplementationOnce(async () => {
      saveReplyOnServer('first', 'Saved anyway')
      throw networkError()
    })
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'Saved anyway')
    await expect.poll(() => thread(screen).getByText('Saved anyway').elements().length).toBe(2)
    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .toBeVisible()

    await thread(screen).getByRole('button', { name: 'common.operation.delete' }).click()
    expect(thread(screen).getByText('Saved anyway').elements()).toHaveLength(1)
    expect(api.reply).toHaveBeenCalledTimes(1)
  })

  it('keeps a new reply’s failure when an older reply has the same text', async () => {
    saveReplyOnServer('first', 'OK', 'reply-old')
    api.reply.mockRejectedValueOnce(networkError())
    const screen = await renderLayer()
    await openThread(screen)
    await expect.element(thread(screen).getByText('OK')).toBeVisible()

    await sendReply(screen, 'OK')

    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .toBeVisible()
    expect(thread(screen).getByText('OK').elements()).toHaveLength(2)
  })

  it('keeps a reply that was saved while the thread could not load', async () => {
    api.detailFails = true
    api.reply.mockImplementationOnce(async () => ({ id: 'reply-saved', created_at: 200 }))
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'Saved while offline')

    const reply = thread(screen).getByText('Saved while offline')
    await expect.poll(() => reply.element().closest('[aria-busy="true"]')).toBeNull()
    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .not.toBeInTheDocument()
  })

  it('keeps each send’s own outcome when the same text is sent twice', async () => {
    api.reply
      .mockImplementationOnce(async () => saveReplyOnServer('first', 'OK', 'reply-ok'))
      .mockRejectedValueOnce(networkError())
    const screen = await renderLayer()
    await openThread(screen)

    await sendReply(screen, 'OK')
    await sendReply(screen, 'OK')

    await expect
      .element(thread(screen).getByText('workflowComments.comments.status.notSent'))
      .toBeVisible()
    expect(thread(screen).getByText('OK').elements()).toHaveLength(2)
  })

  it('keeps an edited comment’s text when an older read lands and the marker then moves', async () => {
    const gate = deferred<void>()
    const send = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(send.promise)
    api.update.mockImplementation(async ({ body }: { body: { content: string } }) => {
      server.current.list[0]!.content = body.content
      return { id: server.current.list[0]!.id, updated_at: 200 }
    })
    const screen = await renderLayer()
    await openThread(screen)
    // A collaborator's change starts a read; a reply still sending holds off reconciling.
    api.listGate = gate.promise
    collaboration.handler?.()
    await sendReply(screen, 'Still sending')

    await thread(screen).getByLabelText('workflowComments.comments.aria.commentActions').click()
    await screen.getByText('workflowComments.comments.actions.editComment').click()
    const editor = screen.getByPlaceholder('workflowComments.comments.placeholder.editComment')
    await editor.fill('Edited')
    await thread(screen).getByRole('button', { name: 'common.operation.save' }).click()
    await expect.element(thread(screen).getByText('Edited')).toBeVisible()
    gate.resolve()
    api.listGate = undefined

    await userEvent.keyboard('{Escape}')
    await expect.element(thread(screen)).not.toBeInTheDocument()
    markers(screen).first().element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Tab}')
    await expect.poll(() => api.update.mock.calls.length).toBe(2)
    expect(api.update.mock.calls[1]![0]).toMatchObject({ body: { content: 'Edited' } })
    send.resolve(saveReplyOnServer('first', 'Still sending'))
  })

  it('keeps an unsaved edit of a sent reply while another reply is sent', async () => {
    api.reply.mockImplementation(async ({ body }: { body: { content: string } }) =>
      saveReplyOnServer('first', body.content),
    )
    const screen = await renderLayer()
    await openThread(screen)
    await sendReply(screen, 'First reply')
    await expect.element(thread(screen).getByText('First reply')).toBeVisible()

    await thread(screen).getByLabelText('workflowComments.comments.aria.replyActions').click()
    await screen.getByText('workflowComments.comments.actions.editReply').click()
    const editor = screen.getByPlaceholder('workflowComments.comments.placeholder.editReply')
    await editor.fill('Half-written edit')
    await sendReply(screen, 'Second reply')

    await expect.element(thread(screen).getByText('Second reply')).toBeVisible()
    await expect.element(editor).toHaveValue('Half-written edit')
  })

  it('keeps a reply’s edit locked while it saves, even after the thread is shown again', async () => {
    saveReplyOnServer('first', 'Original reply', 'reply-original')
    const save = deferred<object>()
    api.updateReply.mockReturnValueOnce(save.promise)
    const screen = await renderLayer()
    await openThread(screen)
    const editReply = async () => {
      await thread(screen).getByLabelText('workflowComments.comments.aria.replyActions').click()
      await screen.getByText('workflowComments.comments.actions.editReply').click()
      return screen.getByPlaceholder('workflowComments.comments.placeholder.editReply')
    }
    const editor = await editReply()
    await editor.fill('Edited reply')
    await thread(screen).getByRole('button', { name: 'common.operation.save' }).click()
    await expect.element(editor).toHaveAttribute('readonly')

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
      .click()
    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.previousComment' })
      .click()
    await expect.element(thread(screen)).toMatchTextContent(/First thread/)
    const again = await editReply()
    await expect.element(again).toHaveAttribute('readonly')

    save.resolve({ id: 'reply-original', updated_at: 200 })
    await expect.element(again).not.toHaveAttribute('readonly')
    expect(api.updateReply).toHaveBeenCalledTimes(1)
  })

  it('drops a sent reply that is deleted elsewhere', async () => {
    api.reply.mockImplementationOnce(async () => saveReplyOnServer('first', 'Gone soon'))
    const screen = await renderLayer()
    await openThread(screen)
    await sendReply(screen, 'Gone soon')
    await expect.element(thread(screen).getByText('Gone soon')).toBeVisible()
    // The reply is sent once the server has answered.
    await expect
      .poll(() => thread(screen).getByText('Gone soon').element().closest('[aria-busy="true"]'))
      .toBeNull()

    server.current.details.first!.replies = []
    collaboration.handler?.()

    await expect.element(thread(screen).getByText('Gone soon')).not.toBeInTheDocument()
  })

  it('does not send while an input method confirms its text, in Safari’s event order', async () => {
    const screen = await renderLayer()
    await openThread(screen)
    await replyBox(screen).fill('你好')
    const box = replyBox(screen).element()

    // Safari reports the composition as ended before the Enter that confirms it.
    box.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )

    await expect.element(replyBox(screen)).toHaveValue('你好')
    expect(api.reply).not.toHaveBeenCalled()
  })

  it('keeps a reply in its own thread when another thread is opened before it is saved', async () => {
    const send = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(send.promise)
    const screen = await renderLayer()
    await openThread(screen)
    await sendReply(screen, 'For the first')

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
      .click()
    await expect.element(thread(screen)).toMatchTextContent(/Second thread/)
    send.resolve(saveReplyOnServer('first', 'For the first'))
    await expect.poll(() => api.reply.mock.results.length).toBe(1)
    await expect.element(thread(screen).getByText('For the first')).not.toBeInTheDocument()

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.previousComment' })
      .click()
    await expect.element(thread(screen).getByText('For the first')).toBeVisible()
  })
})

describe('thread actions', () => {
  it('shows a resolve at once, keeps it through a collaborator’s update, and puts it back on failure', async () => {
    const resolve = deferred<never>()
    api.resolve.mockReturnValueOnce(resolve.promise)
    const screen = await renderLayer()
    await openThread(screen)
    const resolveButton = thread(screen).getByRole('button', {
      name: 'workflowComments.comments.aria.resolveComment',
    })

    resolveButton.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(resolveButton).toBeDisabled()
    await expect.element(resolveButton).toHaveFocus()
    // The server still says unresolved, but a write from here is running.
    collaboration.handler?.()
    await expect.element(resolveButton).toBeDisabled()

    resolve.reject(networkError())
    await expect.element(resolveButton).toBeEnabled()
    expect(collaboration.emit).not.toHaveBeenCalled()
  })

  it('keeps a resolve shown when its thread is shown again before it is saved', async () => {
    const resolve = deferred<{ id: string; resolved: boolean }>()
    api.resolve.mockReturnValueOnce(resolve.promise)
    const screen = await renderLayer()
    await openThread(screen)
    const resolveButton = () =>
      thread(screen).getByRole('button', { name: 'workflowComments.comments.aria.resolveComment' })
    await resolveButton().click()
    await expect.element(resolveButton()).toBeDisabled()

    // Closed and opened again.
    await userEvent.keyboard('{Escape}')
    await expect.element(thread(screen)).not.toBeInTheDocument()
    await openThread(screen)
    await expect.element(resolveButton()).toBeDisabled()
    // Moved to the next comment and back.
    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.nextComment' })
      .click()
    await expect.element(thread(screen)).toMatchTextContent(/Second thread/)
    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.previousComment' })
      .click()
    await expect.element(thread(screen)).toMatchTextContent(/First thread/)

    await expect.element(resolveButton()).toBeDisabled()
    server.current.list[0]!.resolved = true
    server.current.details.first!.resolved = true
    resolve.resolve({ id: 'first', resolved: true })
    await expect.poll(() => collaboration.emit.mock.calls.length).toBe(1)
  })

  it('closes a thread and hides its marker the moment it is resolved, and brings it back if that fails', async () => {
    const resolve = deferred<never>()
    api.resolve.mockReturnValueOnce(resolve.promise)
    const screen = await renderLayer({ hideResolved: true })
    await openThread(screen)

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.resolveComment' })
      .click()

    // The request is still running.
    await expect.element(thread(screen)).not.toBeInTheDocument()
    expect(markers(screen).elements()).toHaveLength(1)

    resolve.reject(networkError())
    await expect.poll(() => markers(screen).elements().length).toBe(2)
    expect(collaboration.emit).not.toHaveBeenCalled()
  })

  it('closes a thread resolved while resolved threads are hidden and tells collaborators', async () => {
    api.resolve.mockImplementationOnce(async ({ params }: { params: { comment_id: string } }) => {
      server.current.list = server.current.list.map((item) =>
        item.id === params.comment_id ? { ...item, resolved: true } : item,
      )
      return { id: params.comment_id, resolved: true, resolved_at: 5, resolved_by: author.id }
    })
    const screen = await renderLayer({ hideResolved: true })
    await openThread(screen)

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.resolveComment' })
      .click()

    await expect.element(thread(screen)).not.toBeInTheDocument()
    expect(markers(screen).elements()).toHaveLength(1)
    expect(collaboration.emit).toHaveBeenCalledWith(TEST_APP_ID)
  })

  it('just closes a deleted thread instead of opening another', async () => {
    api.remove.mockImplementationOnce(async ({ params }: { params: { comment_id: string } }) => {
      server.current.list = server.current.list.filter((item) => item.id !== params.comment_id)
    })
    const screen = await renderLayer()
    await openThread(screen)

    await thread(screen)
      .getByRole('button', { name: 'workflowComments.comments.aria.deleteComment' })
      .click()
    await screen
      .getByRole('alertdialog')
      .getByRole('button', { name: 'common.operation.delete' })
      .click()

    await expect.element(thread(screen)).not.toBeInTheDocument()
    await expect.poll(() => markers(screen).elements()).toHaveLength(1)
  })

  it('shows what collaborators changed while the editor was closed when it opens again', async () => {
    const first = await renderLayer()
    await expect.poll(() => markers(first).elements().length).toBe(2)
    first.unmount()

    server.current.list = server.current.list.slice(1)
    const again = await renderLayer({ queryClient: first.queryClient })

    await expect.poll(() => markers(again).elements().length).toBe(1)
  })

  it('reads an app’s comments again on opening while a comment write to another app runs', async () => {
    const first = await renderLayer()
    await expect.poll(() => markers(first).elements().length).toBe(2)
    first.unmount()

    // A reply to another app's comment is still sending.
    const otherAppSend = deferred<{ id: string; created_at: number }>()
    api.reply.mockReturnValueOnce(otherAppSend.promise)
    void first.queryClient
      .getMutationCache()
      .build(
        first.queryClient,
        consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.post.mutationOptions(),
      )
      .execute({
        params: { app_id: OTHER_APP_ID, comment_id: 'other' },
        body: { content: 'Elsewhere' },
      })
    server.current.list = server.current.list.slice(1)
    const again = await renderLayer({ queryClient: first.queryClient })

    await expect.poll(() => markers(again).elements().length).toBe(1)
    otherAppSend.resolve({ id: 'other-reply', created_at: 1 })
  })

  it('keeps showing the comment when the thread’s first load fails', async () => {
    api.detailFails = true
    const screen = await renderLayer()
    await openThread(screen)

    await expect.element(thread(screen).getByText('First thread')).toBeVisible()
  })
})
