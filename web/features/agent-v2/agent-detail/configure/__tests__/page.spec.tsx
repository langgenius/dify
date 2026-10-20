import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { createDeferred } from '@/test/deferred'
import {
  api,
  buildDraftKey,
  changeMode,
  chatInput,
  cleanupConfigureTest,
  complete,
  composerKey,
  confirm,
  createBuildDraft,
  createComposer,
  createEnvironment,
  createSoul,
  modeButton,
  prefix,
  promptEditor,
  receive,
  restartButton,
  send,
  setupConfigureTest,
  ssePost,
} from './configure-test-env'

beforeEach(setupConfigureTest)
afterEach(cleanupConfigureTest)

describe('Configure page loading and access', () => {
  it('checks the build draft while waiting for the composer', async () => {
    createEnvironment({ composer: null }).render()
    expect(
      screen.getByRole('region', { name: 'agentV2.agentDetail.sections.configure' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(
      screen.getByRole('progressbar', { name: 'agentV2.agentDetail.sections.configure' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: `${prefix}.prompt.label` }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(api.getBuildDraft).toHaveBeenCalled())
  })

  it('waits for the active build draft before initializing the editor', async () => {
    const env = createEnvironment()
    const draft = createDeferred<ReturnType<typeof createBuildDraft>>()
    api.getBuildDraft.mockReturnValue(draft.promise)
    env.render()
    expect(
      screen.getByRole('progressbar', { name: 'agentV2.agentDetail.sections.configure' }),
    ).toBeVisible()
    await act(async () => draft.resolve(createBuildDraft()))
    expect(
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` }),
    ).toHaveTextContent('Built instructions')
    expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
  })

  it('recovers the editable composer after an initial request failure', async () => {
    const env = createEnvironment({ composer: null })
    api.getComposer.mockRejectedValue(new Error('request failed'))
    env.render('?mode=preview')
    await waitFor(() => expect(promptEditor()).toHaveAttribute('contenteditable', 'false'))
    api.getComposer.mockResolvedValue(createComposer(createSoul('Recovered instructions')))
    await act(async () => {
      await env.queryClient.refetchQueries({ queryKey: composerKey })
    })
    await waitFor(() => expect(promptEditor()).toHaveTextContent('Recovered instructions'))
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
  })

  it('restores Preview from the URL without querying a build draft', () => {
    createEnvironment().render('?mode=preview')
    expect(modeButton('preview')).toBeChecked()
    expect(chatInput('preview')).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: `${prefix}.build.inputPlaceholder` }),
    ).not.toBeInTheDocument()
    expect(api.getBuildDraft).not.toHaveBeenCalled()
  })

  it('preserves unrelated URL parameters when switching modes before a build run', async () => {
    const user = userEvent.setup()
    const view = createEnvironment().render('?source=shared-link')
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    await changeMode(user, 'preview')
    expect(view.onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('mode')).toBe('preview')
    expect(view.onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('source')).toBe('shared-link')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    expect(view.onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('mode')).toBe(false)
    expect(view.onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('source')).toBe('shared-link')
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'uses the %s edition to gate Preview independently of the license',
    async (edition) => {
      createEnvironment({ edition }).render('?mode=preview')
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
      if (edition === 'COMMUNITY') {
        expect(modeButton('preview')).toBeDisabled()
        expect(modeButton('build')).toBeChecked()
        expect(
          await screen.findByRole('textbox', { name: `${prefix}.build.inputPlaceholder` }),
        ).toBeVisible()
      } else {
        expect(modeButton('preview')).toBeEnabled()
        expect(modeButton('preview')).toBeChecked()
        expect(chatInput('preview')).toBeVisible()
      }
    },
  )

  it.each([
    [AgentPermission.Edit, true, false, false],
    [AgentPermission.TestAndRun, false, true, false],
    [AgentPermission.ReleaseAndVersion, false, false, true],
  ] as const)(
    'keeps edit, run and publish independent for %s',
    async (permission, canEdit, canRun, canPublish) => {
      createEnvironment({ permissions: [AgentPermission.Preview, permission] }).render()
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
      expect(promptEditor()).toHaveAttribute('contenteditable', String(canEdit))
      expect(modeButton('build')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.publish' }) !== null).toBe(
        canPublish,
      )
      expect(
        screen.queryByRole('textbox', {
          name: new RegExp(`${prefix}.preview.inputPlaceholder`),
        }) !== null,
      ).toBe(canRun)
      expect(api.saveComposer).not.toHaveBeenCalled()
    },
  )

  it('keeps the normal draft editable when the build draft is missing despite existing chat history', async () => {
    createEnvironment().render()
    expect(
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` }),
    ).toHaveTextContent('Draft instructions')
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' })).toBeEnabled()
  })

  it('does not refresh a stale build draft on window focus or reconnect', async () => {
    const env = createEnvironment({ buildDraft: createBuildDraft() })
    env.render()
    await act(async () => {
      await env.queryClient.invalidateQueries({ queryKey: buildDraftKey, refetchType: 'none' })
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    expect(api.getBuildDraft).not.toHaveBeenCalled()
    expect(promptEditor()).toHaveTextContent('Built instructions')
  })
})

describe('Configure chat sessions', () => {
  it('runs and restarts Preview through its own conversation without creating a build draft', async () => {
    const user = userEvent.setup()
    createEnvironment().render('?mode=preview')
    expect(restartButton()).toBeDisabled()
    await send(user, 'preview')
    await receive(0, 'preview-1', 'Preview answer')
    await complete()
    expect(await screen.findByText('Preview answer')).toBeVisible()
    expect(ssePost).toHaveBeenCalledWith(
      'agent/agent-1/chat-messages',
      expect.objectContaining({ body: expect.objectContaining({ query: 'Review this tender' }) }),
      expect.anything(),
    )
    expect(api.track).toHaveBeenCalledWith('agent_preview_mode_run', {
      agent_scope: 'global',
    })
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(api.checkout).not.toHaveBeenCalled()
    await user.click(restartButton())
    await waitFor(() => expect(screen.queryByText('Preview answer')).not.toBeInTheDocument())
    expect(api.refresh).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: { draft_type: 'draft' },
    })
    expect(restartButton()).toBeDisabled()
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    expect(api.refresh).toHaveBeenLastCalledWith({ params: { agent_id: 'agent-1' } })
  })

  it('clears Build through confirmation and leaves later Preview messages intact', async () => {
    const user = userEvent.setup()
    createEnvironment().render()
    expect(await screen.findByText('Earlier answer')).toBeVisible()
    await user.click(restartButton())
    expect(api.refresh).not.toHaveBeenCalled()
    await confirm(user)
    await waitFor(() => expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument())
    await changeMode(user, 'preview')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await send(user, 'preview')
    await receive(0, 'preview-1', 'A new preview answer')
    await complete()
    expect(await screen.findByText('A new preview answer')).toBeVisible()
    expect(api.discard).not.toHaveBeenCalled()
  })

  it('starts a fresh Preview conversation when the page is closed and reopened', async () => {
    const user = userEvent.setup()
    const view = createEnvironment().render('?mode=preview')
    await send(user, 'preview')
    await receive(0, 'preview-1', 'Previous preview answer')
    await complete()
    expect(await screen.findByText('Previous preview answer')).toBeVisible()
    view.show(false)
    expect(screen.queryByText('Previous preview answer')).not.toBeInTheDocument()
    view.show(true)
    await send(user, 'preview', 'New preview request')
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    expect(ssePost.mock.calls[1]?.[1].body).toMatchObject({ conversation_id: '' })
    expect(screen.queryByText('Previous preview answer')).not.toBeInTheDocument()
  })

  it('does not enable restart for an empty Build conversation', async () => {
    const user = userEvent.setup()
    createEnvironment({ conversationId: null }).render()
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    expect(restartButton()).toBeDisabled()
    await user.click(restartButton())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('restores the normal composer and keeps a stale build draft hidden until a new run', async () => {
    const user = userEvent.setup()
    createEnvironment({ buildDraft: createBuildDraft() }).render('?mode=preview')
    expect(promptEditor()).toHaveTextContent('Draft instructions')
    await changeMode(user, 'build')
    await waitFor(() => expect(modeButton('build')).toBeChecked())
    expect(promptEditor()).toHaveTextContent('Draft instructions')
    expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
    expect(api.checkout).not.toHaveBeenCalled()
    await changeMode(user, 'preview')
    expect(modeButton('preview')).toBeChecked()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.discard).not.toHaveBeenCalled()
  })

  it('shows active Build chat features as read-only using the build snapshot', async () => {
    const user = userEvent.setup()
    createEnvironment({
      composer: createComposer(
        createSoul('Draft instructions', { app_features: { opening_statement: 'Draft opening' } }),
      ),
      buildDraft: createBuildDraft(
        createSoul('Built instructions', { app_features: { opening_statement: 'Build opening' } }),
      ),
    }).render()
    await user.click(screen.getByRole('button', { name: `${prefix}.preview.chatFeatures` }))
    const panel = within(
      await screen.findByRole('dialog', { name: `${prefix}.chatFeatures.title` }),
    )
    expect(panel.getByText('Build opening')).toBeVisible()
    const opener = panel.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' })
    expect(opener).toHaveAttribute('aria-disabled', 'true')
    await user.click(opener)
    expect(opener).toBeChecked()
    expect(api.saveComposer).not.toHaveBeenCalled()
  })
})
