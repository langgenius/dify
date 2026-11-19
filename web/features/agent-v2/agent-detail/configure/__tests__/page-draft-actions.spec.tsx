import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { createDeferred } from '@/test/deferred'
import {
  api,
  applyButton,
  cleanupConfigureTest,
  confirm,
  createBuildDraft,
  createComposer,
  createEnvironment,
  createSoul,
  discardButton,
  prefix,
  promptEditor,
  restartButton,
  setupConfigureTest,
  versionsButton,
} from './configure-test-env'

beforeEach(setupConfigureTest)
afterEach(cleanupConfigureTest)

describe('Build draft actions', () => {
  it('keeps the built instructions and loading action until the applied composer refreshes', async () => {
    const user = userEvent.setup()
    createEnvironment({ buildDraft: createBuildDraft() }).render()
    const refreshed = createDeferred<ReturnType<typeof createComposer>>()
    api.getComposer.mockReturnValue(refreshed.promise)
    await user.click(applyButton())
    await waitFor(() => expect(api.getComposer).toHaveBeenCalled())
    expect(promptEditor()).toHaveTextContent('Built instructions')
    expect(applyButton()).toHaveAttribute('aria-disabled', 'true')
    expect(api.success).not.toHaveBeenCalled()
    expect(api.finalize).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } })
    expect(api.apply).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } })
    expect(api.finalize.mock.invocationCallOrder[0]).toBeLessThan(
      api.apply.mock.invocationCallOrder[0]!,
    )
    await act(async () => refreshed.resolve(createComposer(createSoul('Applied instructions'))))
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Applied instructions'))
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
    expect(api.refresh).toHaveBeenCalledWith({ params: { agent_id: 'agent-1' } })
    expect(api.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('stops applying after finalize fails, preserves the draft and allows retry', async () => {
    const user = userEvent.setup()
    createEnvironment({ buildDraft: createBuildDraft() }).render()
    api.finalize.mockRejectedValueOnce(new Error('finalize failed'))
    await user.click(applyButton())
    await waitFor(() => expect(api.finalize).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(applyButton()).toBeEnabled())
    expect(api.apply).not.toHaveBeenCalled()
    expect(api.error).not.toHaveBeenCalledWith('common.api.actionFailed')
    expect(api.success).not.toHaveBeenCalled()
    expect(promptEditor()).toHaveTextContent('Built instructions')
    api.getComposer.mockResolvedValue(createComposer(createSoul('Applied instructions')))
    await user.click(applyButton())
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Applied instructions'))
  })

  it.each(['discard', 'restart'] as const)(
    '%s removes the build draft and starts an empty session',
    async (action) => {
      const user = userEvent.setup()
      createEnvironment({ buildDraft: createBuildDraft() }).render()
      expect(await screen.findByText('Earlier answer')).toBeVisible()
      if (action === 'restart') {
        await user.click(restartButton())
        expect(api.discard).not.toHaveBeenCalled()
        await confirm(user)
      } else {
        await user.click(discardButton())
        await confirm(user)
      }
      await waitFor(() => expect(promptEditor()).toHaveAttribute('contenteditable', 'true'))
      expect(promptEditor()).toHaveTextContent('Draft instructions')
      expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument()
      expect(api.discard).toHaveBeenCalledWith({ params: { agent_id: 'agent-1' } })
      expect(api.refresh).toHaveBeenCalledWith({ params: { agent_id: 'agent-1' } })
      expect(restartButton()).toBeDisabled()
    },
  )

  it.each(['apply', 'discard'] as const)(
    'finishes %s even if refreshing the debug conversation fails',
    async (action) => {
      const user = userEvent.setup()
      createEnvironment({ buildDraft: createBuildDraft() }).render()
      api.refresh.mockRejectedValueOnce(new Error('refresh failed'))
      if (action === 'apply')
        api.getComposer.mockResolvedValue(createComposer(createSoul('Applied instructions')))
      await user.click(action === 'apply' ? applyButton() : discardButton())
      if (action === 'discard') await confirm(user)
      await waitFor(() => expect(promptEditor()).toHaveAttribute('contenteditable', 'true'))
      expect(promptEditor()).toHaveTextContent(
        action === 'apply' ? 'Applied instructions' : 'Draft instructions',
      )
      expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
      expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument()
      expect(api.refresh).toHaveBeenCalled()
    },
  )

  it('offers build actions instead of publishing or opening version history while a build draft is active', () => {
    createEnvironment({ buildDraft: createBuildDraft() }).render()
    expect(applyButton()).toBeEnabled()
    expect(discardButton()).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'agentV2.agentDetail.publish' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `${prefix}.publishBar.versionHistory` }),
    ).not.toBeInTheDocument()
  })
})

describe('Version restoration', () => {
  it('saves pending edits before restoring through the version menu and rebases the editor', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    const save = createDeferred<ReturnType<typeof createComposer>>()
    api.saveComposer.mockReturnValueOnce(save.promise)
    api.getComposer.mockResolvedValue(createComposer(createSoul('Restored instructions')))
    await replacePromptEditorText(promptEditor(), 'Unsaved instructions')
    await user.click(versionsButton())
    await user.click(await screen.findByRole('button', { name: /moreActions.*Published update/ }))
    await user.click(screen.getByRole('menuitem', { name: /restore/i }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(api.restore).not.toHaveBeenCalled()
    await user.click(dialog.getByRole('button', { name: /restore/i }))
    await waitFor(() => expect(api.saveComposer).toHaveBeenCalled())
    expect(api.restore).not.toHaveBeenCalled()
    expect(api.getComposer).not.toHaveBeenCalled()
    await act(async () => save.resolve(createComposer(createSoul('Unsaved instructions'))))
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledWith({
        params: { agent_id: 'agent-1', version_id: 'version-2' },
      }),
    )
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Restored instructions'))
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the selected version read-only and restores it through the composer action', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    api.getComposer.mockResolvedValue(createComposer(createSoul('Restored instructions')))
    await user.click(versionsButton())
    await user.click(await screen.findByRole('button', { name: /^Published update/ }))
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Published instructions'))
    expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
    await user.click(
      screen.getByRole('button', { name: 'agentV2.agentDetail.versionHistory.restore' }),
    )
    expect(api.restore).not.toHaveBeenCalled()
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: /restore/i }),
    )
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Restored instructions'))
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(api.restore).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1', version_id: 'version-2' },
    })
  })
})
