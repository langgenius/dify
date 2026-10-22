import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { createDeferred } from '@/test/deferred'
import {
  api,
  applyButton,
  changeMode,
  chatInput,
  cleanupConfigureTest,
  complete,
  confirm,
  createBuildDraft,
  createComposer,
  createEnvironment,
  createSoul,
  discardButton,
  emptyConversation,
  flushBuildRefresh,
  modeButton,
  prefix,
  promptEditor,
  receive,
  restartButton,
  send,
  setupConfigureTest,
  ssePost,
  workingDirectoryButton,
} from './configure-test-env'

beforeEach(setupConfigureTest)
afterEach(cleanupConfigureTest)

describe('Starting Build', () => {
  it('keeps the composer editable while resetting the session, then saves before forcing checkout and sending', async () => {
    const user = userEvent.setup()
    const env = createEnvironment({ buildDraft: createBuildDraft() })
    const refresh = createDeferred<typeof emptyConversation>()
    const save = createDeferred<ReturnType<typeof createComposer>>()
    api.refresh.mockReturnValueOnce(refresh.promise)
    api.saveComposer.mockReturnValueOnce(save.promise)
    env.render('?mode=preview')
    await changeMode(user, 'build')
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(promptEditor()).toHaveTextContent('Draft instructions')
    expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument()
    expect(api.checkout).not.toHaveBeenCalled()
    await act(async () => refresh.resolve(emptyConversation))
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    await replacePromptEditorText(promptEditor(), 'Edited instructions')
    await send(user)
    expect(api.saveComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({ prompt: { system_prompt: 'Edited instructions' } }),
        }),
      }),
    )
    expect(api.checkout).not.toHaveBeenCalled()
    expect(ssePost).not.toHaveBeenCalled()
    expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
    await act(async () => save.resolve(createComposer(createSoul('Edited instructions'))))
    await receive()
    expect(api.checkout).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: { force: true },
    })
    expect(promptEditor()).toHaveTextContent('Built instructions')
    // The first streamed answer also loads the production Markdown renderer asynchronously.
    expect(await screen.findByText('Built answer', {}, { timeout: 5000 })).toBeVisible()
  }, 10000)

  it('stays in Preview when resetting the Build conversation fails', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    api.refresh.mockRejectedValueOnce(new Error('refresh failed'))
    await changeMode(user, 'build')
    await waitFor(() => expect(api.error).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(modeButton('preview')).toBeChecked()
    expect(chatInput('preview')).toBeVisible()
    expect(api.checkout).not.toHaveBeenCalled()
  })

  it('preserves edits and does not checkout or send when saving fails', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    api.saveComposer.mockRejectedValue(new Error('save failed'))
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    await replacePromptEditorText(promptEditor(), 'Unsaved instructions')
    await send(user)
    await waitFor(() => expect(api.error).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(promptEditor()).toHaveTextContent('Unsaved instructions')
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(api.checkout).not.toHaveBeenCalled()
    expect(ssePost).not.toHaveBeenCalled()
    expect(api.track).not.toHaveBeenCalled()
  })

  it('allows retry after force checkout fails without sending the failed run', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    api.checkout.mockRejectedValueOnce(new Error('checkout failed'))
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    await send(user)
    await waitFor(() => expect(api.error).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(ssePost).not.toHaveBeenCalled()
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    await send(user, 'build', 'Try again')
    await receive()
    expect(api.checkout).toHaveBeenCalledTimes(2)
    expect(api.checkout).toHaveBeenLastCalledWith({
      params: { agent_id: 'agent-1' },
      body: { force: true },
    })
    expect(await screen.findByText('Built answer')).toBeVisible()
  })

  it('requires an explicitly selected model despite a workspace default', async () => {
    const user = userEvent.setup()
    createEnvironment({
      composer: createComposer(createSoul('Instructions', { model: undefined })),
    }).render()
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    await send(user)
    await waitFor(() =>
      expect(api.error).toHaveBeenCalledWith('modelProvider.modelProvider.selectModel'),
    )
    expect(api.checkout).not.toHaveBeenCalled()
    expect(ssePost).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  })

  it('checks out the first draft without losing the submitted message and tracks the run', async () => {
    const user = userEvent.setup()
    createEnvironment({ conversationId: null }).render()
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    expect(workingDirectoryButton()).not.toBeInTheDocument()
    await send(user, 'build', 'Build the reviewer')
    await receive()
    expect(api.checkout).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: { force: false },
    })
    expect(await screen.findByText('Build the reviewer')).toBeVisible()
    expect(await screen.findByText('Built answer')).toBeVisible()
    expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
    expect(applyButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()
    expect(api.track).toHaveBeenCalledWith('agent_build_mode_run', {
      agent_scope: 'global',
    })
    expect(workingDirectoryButton()).not.toBeInTheDocument()
    await complete()
    expect(workingDirectoryButton()).toBeVisible()
    await user.click(workingDirectoryButton()!)
    expect(await screen.findByRole('dialog', { name: 'result.txt' })).toBeVisible()
    expect(await screen.findByText('Build result')).toBeVisible()
  })
})

describe('Leaving Build', () => {
  it('keeps the streaming draft and URL when leaving Build is cancelled', async () => {
    const user = userEvent.setup()
    const view = createEnvironment({ buildDraft: createBuildDraft() }).render()
    await send(user)
    await receive()
    await changeMode(user, 'preview')
    expect(api.discard).not.toHaveBeenCalled()
    expect(view.onUrlUpdate).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.cancel',
      }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Built answer')).toBeVisible()
    expect(modeButton('build')).toBeChecked()
    expect(api.stop).not.toHaveBeenCalled()
    expect(api.discard).not.toHaveBeenCalled()
    expect(view.onUrlUpdate).not.toHaveBeenCalled()
  })

  it('stops streaming before discarding, waits to change URL, and ignores late completion', async () => {
    const user = userEvent.setup()
    const discard = createDeferred<{ result: string }>()
    const view = createEnvironment({ buildDraft: createBuildDraft() }).render()
    api.discard.mockReturnValueOnce(discard.promise)
    await send(user)
    await receive()
    await changeMode(user, 'preview')
    await confirm(user)
    expect(api.stop).toHaveBeenCalledWith({ params: { agent_id: 'agent-1', task_id: 'task-0' } })
    expect(api.stop.mock.invocationCallOrder[0]).toBeLessThan(
      api.discard.mock.invocationCallOrder[0]!,
    )
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(view.onUrlUpdate).not.toHaveBeenCalled()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await complete()
    await flushBuildRefresh()
    expect(api.getBuildDraft).not.toHaveBeenCalled()
    vi.useRealTimers()
    await act(async () => discard.resolve({ result: 'success' }))
    await waitFor(() => expect(modeButton('preview')).toBeChecked())
    expect(view.onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('mode')).toBe('preview')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await complete()
    await flushBuildRefresh()
    expect(api.getBuildDraft).not.toHaveBeenCalled()
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByText('Built answer')).not.toBeInTheDocument()
  })

  it('keeps the draft and confirmation open when discard fails, then supports retry', async () => {
    const user = userEvent.setup()
    createEnvironment({ buildDraft: createBuildDraft() }).render()
    api.discard.mockRejectedValueOnce(new Error('discard failed'))
    await changeMode(user, 'preview')
    await confirm(user)
    await waitFor(() => expect(api.error).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(screen.getByRole('alertdialog')).toBeVisible()
    await confirm(user)
    await waitFor(() => expect(modeButton('preview')).toBeChecked())
    expect(api.discard).toHaveBeenCalledTimes(2)
  })

  it('resets a failed run and can leave Build without another discard confirmation', async () => {
    const user = userEvent.setup()
    createEnvironment().render()
    api.checkout.mockRejectedValueOnce(new Error('checkout failed'))
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    await send(user)
    await waitFor(() => expect(api.checkout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(promptEditor()).toHaveAttribute('contenteditable', 'true'))
    expect(ssePost).not.toHaveBeenCalled()
    await user.click(restartButton())
    await confirm(user)
    await waitFor(() => expect(restartButton()).toBeDisabled())
    await changeMode(user, 'preview')
    expect(modeButton('preview')).toBeChecked()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.discard).not.toHaveBeenCalled()
  })
})

describe('Build stream completion', () => {
  it('does not expose working files for a draft without a conversation', async () => {
    createEnvironment({ buildDraft: createBuildDraft(), conversationId: null }).render()
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    expect(applyButton()).toBeEnabled()
    expect(workingDirectoryButton()).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'unlocks draft actions after the completion refresh (failure: %s)',
    async (fails) => {
      const user = userEvent.setup()
      createEnvironment({ buildDraft: createBuildDraft() }).render()
      if (fails) api.getBuildDraft.mockRejectedValue(new Error('refresh failed'))
      expect(applyButton()).toBeEnabled()
      await send(user)
      await receive()
      expect(api.checkout).not.toHaveBeenCalled()
      expect(api.track).toHaveBeenCalledWith('agent_build_mode_run', { agent_scope: 'global' })
      expect(applyButton()).toBeDisabled()
      expect(discardButton()).toBeDisabled()
      expect(restartButton()).toBeDisabled()
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await complete()
      expect(api.getBuildDraft).not.toHaveBeenCalled()
      await flushBuildRefresh()
      expect(api.getBuildDraft).toHaveBeenCalledTimes(1)
      expect(applyButton()).toBeEnabled()
      expect(discardButton()).toBeEnabled()
    },
  )

  it.each(['scheduled', 'in-flight'] as const)(
    'does not let a %s refresh overwrite or unlock a newer Build run',
    async (phase) => {
      const user = userEvent.setup()
      createEnvironment({ buildDraft: createBuildDraft() }).render()
      const staleRefresh = createDeferred<ReturnType<typeof createBuildDraft>>()
      if (phase === 'in-flight') api.getBuildDraft.mockReturnValueOnce(staleRefresh.promise)
      await send(user)
      await receive()
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await complete()
      if (phase === 'in-flight') {
        await flushBuildRefresh()
        expect(api.getBuildDraft).toHaveBeenCalledTimes(1)
      }
      vi.useRealTimers()
      await send(user, 'build', 'Follow-up request')
      await receive(1, 'new-build', 'Second answer')
      vi.useFakeTimers({ shouldAdvanceTime: true })
      if (phase === 'in-flight')
        await act(async () =>
          staleRefresh.resolve(createBuildDraft(createSoul('Stale instructions'))),
        )
      else {
        await flushBuildRefresh()
        expect(api.getBuildDraft).not.toHaveBeenCalled()
      }
      expect(promptEditor()).toHaveTextContent('Built instructions')
      expect(applyButton()).toBeDisabled()
      expect(discardButton()).toBeDisabled()
      await complete(1)
      await flushBuildRefresh()
      expect(applyButton()).toBeEnabled()
    },
  )

  it('reopens persisted Build history without retaining a previous page action lock', async () => {
    const user = userEvent.setup()
    const env = createEnvironment({ buildDraft: createBuildDraft() })
    const view = env.render()
    await send(user)
    await receive()
    expect(applyButton()).toBeDisabled()
    view.show(false)
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
    view.show(true)
    expect(await screen.findByText('Earlier answer')).toBeVisible()
    expect(applyButton()).toBeEnabled()
    expect(discardButton()).toBeEnabled()
  })
})
