import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { StrictMode, useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { difyBuilderPendingCreationAtom } from '../creation'
import { DifyBuilderProvider } from '../provider'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'
import {
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderStartPromptAtom,
  difyBuilderStartRunFixAtom,
} from '../store'

const mocks = vi.hoisted(() => ({
  controllerHook: vi.fn(),
  focusCanvas: vi.fn(),
  refreshCanvas: vi.fn<(shouldApply: () => boolean) => Promise<boolean>>(async () => true),
  reset: vi.fn(),
  restore: vi.fn(async () => true),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  setCanvasReadOnly: vi.fn(),
  invalidateWorkflowDraftSync: vi.fn(),
  setShowPanel: vi.fn(),
  selectWorkflowNode: vi.fn(),
  startBuild: vi.fn(async () => true),
  startChecklistFix: vi.fn(async () => true),
  startEdit: vi.fn(async () => true),
  startFix: vi.fn(async () => true),
  syncDraft: vi.fn(async () => undefined),
  updateModel: vi.fn(async () => true),
}))

vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  selectWorkflowNode: mocks.selectWorkflowNode,
}))

vi.mock('../session/use-session-controller', () => ({
  useDifyBuilderSessionController: () => {
    mocks.controllerHook()
    return {
      refresh: vi.fn(),
      loadOlderConversation: vi.fn(async () => true),
      restore: mocks.restore,
      reset: mocks.reset,
      runAction: mocks.runAction,
      sendMessage: mocks.sendMessage,
      startBuild: mocks.startBuild,
      startChecklistFix: mocks.startChecklistFix,
      startEdit: mocks.startEdit,
      startFix: mocks.startFix,
      updateModel: mocks.updateModel,
    }
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      invalidateWorkflowDraftSync: typeof mocks.invalidateWorkflowDraftSync
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      invalidateWorkflowDraftSync: mocks.invalidateWorkflowDraftSync,
      setShowDifyBuilderPanel: mocks.setShowPanel,
    }),
}))

const Probe = () => {
  const canvasRefreshFailed = useAtomValue(difyBuilderCanvasRefreshFailedAtom)
  const canvasRefreshGeneration = useAtomValue(difyBuilderCanvasRefreshGenerationAtom)
  const canvasRefreshing = useAtomValue(difyBuilderCanvasRefreshingAtom)
  const localError = useAtomValue(difyBuilderLocalErrorAtom)
  const recheckReady = useAtomValue(difyBuilderRecheckReadyAtom)
  const registerChecklistErrors = useSetAtom(difyBuilderRegisterChecklistErrorsAtom)
  const retryCanvasRefresh = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
  const setLastCanvasEvent = useSetAtom(difyBuilderSessionLastCanvasEventAtom)
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const setBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const setSessionView = useSetAtom(difyBuilderSessionViewAtom)
  const startPrompt = useSetAtom(difyBuilderStartPromptAtom)
  const startRunFix = useSetAtom(difyBuilderStartRunFixAtom)
  const [draft, setDraft] = useAtom(difyBuilderDraftAtom)
  return (
    <>
      <button type="button" onClick={() => setBusy(true)}>
        Start command
      </button>
      <button type="button" onClick={() => setBusy(false)}>
        Finish command
      </button>
      <button type="button" onClick={() => setSessionView(null)}>
        Reset view
      </button>
      <button type="button" onClick={() => void startPrompt('Build a support bot')}>
        Send prompt
      </button>
      <button type="button" onClick={() => void startRunFix('failed-run-42')}>
        Fix run
      </button>
      <button
        type="button"
        onClick={() => {
          setActiveSessionId('session-1')
          setSessionView({
            app_id: 'app-1',
            canvas_read_only: true,
            conversation_last_seq: -1,
            interrupted: false,
            run_status: 'processing',
            session_id: 'session-1',
            state: 'fix.diagnose',
            version: 1,
          })
        }}
      >
        Stream update
      </button>
      <button type="button" onClick={() => setActiveSessionId(null)}>
        End session
      </button>
      <button
        type="button"
        onClick={() =>
          setSessionView({
            app_id: 'app-1',
            canvas_read_only: false,
            conversation_last_seq: -1,
            entry_mode: 'fix_checklist',
            interrupted: false,
            phase: 'test',
            run_status: 'waiting_input',
            session_id: 'session-1',
            state: 'checklist.await_recheck',
            version: 2,
          })
        }
      >
        Refresh update
      </button>
      <button
        type="button"
        onClick={() => registerChecklistErrors({ errors: [], generation: canvasRefreshGeneration })}
      >
        Register checklist
      </button>
      <button type="button" onClick={() => retryCanvasRefresh()}>
        Retry canvas refresh
      </button>
      <button
        type="button"
        onClick={() =>
          setLastCanvasEvent({
            id: 1,
            data: {
              at_version: 2,
              event: 'highlight_edit_target',
              node_id: 'llm-1',
              operation_id: 'operation-1',
              revision: 1,
              session_id: 'session-1',
              stage_id: 'fix.diagnose',
            },
          })
        }
      >
        Focus event node
      </button>
      <button
        type="button"
        onClick={() =>
          setLastCanvasEvent({
            id: 2,
            data: {
              at_version: 2,
              event: 'focus_workflow',
              operation_id: 'operation-1',
              revision: 2,
              session_id: 'session-1',
              stage_id: 'fix.diagnose',
            },
          })
        }
      >
        Focus event canvas
      </button>
      <output aria-label="Canvas refreshing">{String(canvasRefreshing)}</output>
      <textarea
        aria-label="Builder draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <output aria-label="Canvas refresh failed">{String(canvasRefreshFailed)}</output>
      <output aria-label="Canvas refresh error">{localError}</output>
      <output aria-label="Refresh generation">{canvasRefreshGeneration}</output>
      <output aria-label="Recheck ready">{String(recheckReady)}</output>
    </>
  )
}

const renderProvider = (edgeCount = 0, difyBuilderEnabled = true, userId = 'user-1') =>
  renderWithConsoleQuery(
    <DifyBuilderProvider
      appId="app-1"
      canEdit
      getCanvasSnapshot={() => ({ nodes: [], edgeCount })}
      onFocusCanvas={mocks.focusCanvas}
      onRefreshCanvas={mocks.refreshCanvas}
      onSyncDraft={mocks.syncDraft}
      tenantId="workspace-1"
      userId={userId}
    >
      <Probe />
    </DifyBuilderProvider>,
    { features: { dify_builder_enabled: difyBuilderEnabled } },
  )

const CreationNavigation = ({
  appId = 'created-app',
  canEdit = true,
}: {
  appId?: string
  canEdit?: boolean
}) => {
  const setPendingCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const [showEditor, setShowEditor] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPendingCreation({ appId: 'created-app', prompt: 'Build an expense workflow' })
          setShowEditor(true)
        }}
      >
        Create with Builder
      </button>
      <button type="button" onClick={() => setShowEditor(false)}>
        Back to apps
      </button>
      <button type="button" onClick={() => setShowEditor(true)}>
        Reopen app
      </button>
      {showEditor && (
        <DifyBuilderProvider
          appId={appId}
          canEdit={canEdit}
          canStartCreation
          getCanvasSnapshot={() => ({ nodes: [], edgeCount: 0 })}
          onFocusCanvas={mocks.focusCanvas}
          onRefreshCanvas={mocks.refreshCanvas}
          onSyncDraft={mocks.syncDraft}
          tenantId="workspace-1"
          userId="user-1"
        >
          <Probe />
        </DifyBuilderProvider>
      )}
    </>
  )
}

describe('DifyBuilderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshCanvas.mockReset().mockResolvedValue(true)
    mocks.restore.mockReset().mockResolvedValue(true)
    mocks.startBuild.mockReset().mockResolvedValue(true)
    mocks.syncDraft.mockReset().mockResolvedValue(undefined)
    window.sessionStorage.clear()
  })

  it('starts a build session for an empty canvas', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
    expect(mocks.startBuild).toHaveBeenCalledWith('app-1', 'Build a support bot', undefined)
    expect(mocks.startEdit).not.toHaveBeenCalled()
  })

  it('opens the panel and sends a creation prompt once across navigation and strict remounts', async () => {
    let finishBuild: (started: boolean) => void = () => undefined
    mocks.startBuild.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishBuild = resolve
        }),
    )
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <StrictMode>
        <CreationNavigation />
      </StrictMode>,
      {
        features: { dify_builder_enabled: true },
      },
    )

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense workflow',
        undefined,
      ),
    )
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.syncDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue('')

    await act(async () => finishBuild(true))

    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Back to apps' }))
    await user.click(screen.getByRole('button', { name: 'Reopen app' }))
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })

  it('retains the initial prompt in the panel when Builder cannot start', async () => {
    mocks.startBuild.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationNavigation />, { features: { dify_builder_enabled: true } })

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    await waitFor(() => expect(mocks.startBuild).toHaveBeenCalledOnce())
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue(
      'Build an expense workflow',
    )
  })

  it('restores the creation prompt when draft synchronization fails', async () => {
    mocks.syncDraft.mockRejectedValueOnce(new Error('Workflow draft sync failed.'))
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationNavigation />, { features: { dify_builder_enabled: true } })

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue(
      'Build an expense workflow',
    )
    expect(screen.getByRole('status', { name: 'Canvas refresh error' })).toHaveTextContent(
      'Workflow draft sync failed.',
    )
  })

  it('restores the creation prompt when starting the Builder throws', async () => {
    mocks.startBuild.mockRejectedValueOnce(new Error('Connection failed.'))
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationNavigation />, { features: { dify_builder_enabled: true } })

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue(
      'Build an expense workflow',
    )
    expect(screen.getByRole('status', { name: 'Canvas refresh error' })).toHaveTextContent(
      'Connection failed.',
    )
  })

  it.each([true, false])(
    'preserves a newer draft after the creation request settles with %s',
    async (started) => {
      let finishBuild: (started: boolean) => void = () => undefined
      mocks.startBuild.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishBuild = resolve
          }),
      )
      const user = userEvent.setup()
      renderWithConsoleQuery(<CreationNavigation />, { features: { dify_builder_enabled: true } })

      await user.click(screen.getByRole('button', { name: 'Create with Builder' }))
      await waitFor(() => expect(mocks.startBuild).toHaveBeenCalledOnce())
      const input = screen.getByRole('textbox', { name: 'Builder draft' })
      await user.clear(input)
      await user.type(input, 'Also handle invoice uploads')

      await act(async () => finishBuild(started))

      expect(input).toHaveValue('Also handle invoice uploads')
    },
  )

  it.each([
    { appId: 'another-app', canEdit: true, enabled: true },
    { appId: 'created-app', canEdit: false, enabled: true },
    { appId: 'created-app', canEdit: true, enabled: false },
  ])(
    'does not start a creation request in an unavailable editor: %j',
    async ({ appId, canEdit, enabled }) => {
      const user = userEvent.setup()
      renderWithConsoleQuery(<CreationNavigation appId={appId} canEdit={canEdit} />, {
        features: { dify_builder_enabled: enabled },
      })
      await user.click(screen.getByRole('button', { name: 'Create with Builder' }))
      expect(mocks.startBuild).not.toHaveBeenCalled()
      expect(mocks.setShowPanel).not.toHaveBeenCalled()
    },
  )

  it('restores and persists the tenant-user-app-scoped unfinished session id', async () => {
    const key = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    window.sessionStorage.setItem(key, 'stored-session')
    const user = userEvent.setup()
    renderProvider()

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('stored-session'))

    await user.click(screen.getByRole('button', { name: 'Stream update' }))

    expect(window.sessionStorage.getItem(key)).toBe('session-1')
  })

  it('retains the unfinished session id when restore fails without a definitive response', async () => {
    mocks.restore.mockResolvedValueOnce(false)
    const key = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    window.sessionStorage.setItem(key, 'stored-session')

    renderProvider()

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('stored-session'))
    expect(window.sessionStorage.getItem(key)).toBe('stored-session')
  })

  it('isolates saved session ids between collaborators on the same app', async () => {
    const userOneKey = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    const userTwoKey = 'dify-builder:v1:workspace-1:user-2:app-1:active-session-id'
    window.sessionStorage.setItem(userOneKey, 'user-one-session')
    window.sessionStorage.setItem(userTwoKey, 'user-two-session')

    const first = renderProvider()
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('user-one-session'))
    first.unmount()
    mocks.restore.mockClear()

    renderProvider(0, true, 'user-2')
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('user-two-session'))
    expect(mocks.restore).not.toHaveBeenCalledWith('user-one-session')
  })

  it('removes the persisted pointer when the session ends', async () => {
    const key = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Stream update' }))
    expect(window.sessionStorage.getItem(key)).toBe('session-1')

    await user.click(screen.getByRole('button', { name: 'End session' }))
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })

  it('starts an edit session for a connected canvas', async () => {
    const user = userEvent.setup()
    renderProvider(1)

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(mocks.startEdit).toHaveBeenCalledWith('app-1', 'Build a support bot', undefined)
    expect(mocks.startBuild).not.toHaveBeenCalled()
  })

  it('opens a fix session for the selected failed run id', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Fix run' }))

    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.startFix).toHaveBeenCalledWith('app-1', 'failed-run-42', undefined)
  })

  it('blocks Builder session entry while the feature is disabled', async () => {
    const user = userEvent.setup()
    renderProvider(0, false)

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))
    await user.click(screen.getByRole('button', { name: 'Fix run' }))

    expect(mocks.setShowPanel).not.toHaveBeenCalled()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(mocks.startFix).not.toHaveBeenCalled()
  })

  it('invalidates queued draft saves when a Builder command takes the canvas lock', async () => {
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'Start command' }))
    expect(mocks.invalidateWorkflowDraftSync).toHaveBeenCalledOnce()
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(true)
  })

  it('prevents an in-flight canvas refresh from applying after session reset', async () => {
    let resolveResponse!: (value: boolean) => void
    mocks.refreshCanvas.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'Refresh update' }))
    const shouldApply = mocks.refreshCanvas.mock.calls[0]![0]
    expect(shouldApply()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(shouldApply()).toBe(false)
    await act(async () => resolveResponse(true))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
  })

  it('retries an interrupted refresh even when the command returns the same session version', async () => {
    let resolveRefresh!: (value: boolean) => void
    mocks.refreshCanvas.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'Refresh update' }))
    await user.click(screen.getByRole('button', { name: 'Start command' }))
    await act(async () => resolveRefresh(false))
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledTimes(2))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
  })

  it('does not rerender the controller boundary for streamed session updates', async () => {
    const user = userEvent.setup()
    renderProvider()
    const initialRenderCount = mocks.controllerHook.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Stream update' }))

    expect(mocks.controllerHook).toHaveBeenCalledTimes(initialRenderCount)
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(true)
  })

  it('keeps recheck blocked until a refreshed canvas is evaluated', async () => {
    let resolveRefresh: (refreshed: boolean) => void = () => undefined
    mocks.refreshCanvas.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Refresh update' }))

    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledOnce())
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await act(async () => resolveRefresh(true))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Refresh generation' })).toHaveTextContent('1'),
    )
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Register checklist' }))

    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('true')
  })

  it('treats a false refresh as failure and advances generation only after retry succeeds', async () => {
    let resolveRetry: (refreshed: boolean) => void = () => undefined
    mocks.refreshCanvas.mockResolvedValueOnce(false).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRetry = resolve
        }),
    )
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Refresh update' }))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Canvas refresh failed' })).toHaveTextContent(
        'true',
      ),
    )
    expect(screen.getByRole('status', { name: 'Refresh generation' })).toHaveTextContent('0')
    expect(screen.getByRole('status', { name: 'Canvas refresh error' })).toHaveTextContent(
      'Workflow canvas refresh failed.',
    )
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Retry canvas refresh' }))

    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await act(async () => resolveRetry(true))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Refresh generation' })).toHaveTextContent('1'),
    )
    expect(screen.getByRole('status', { name: 'Canvas refresh failed' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Register checklist' }))

    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('true')
  })

  it('applies focus-only canvas events without refreshing the draft', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Focus event node' }))
    await user.click(screen.getByRole('button', { name: 'Focus event canvas' }))

    expect(mocks.selectWorkflowNode).toHaveBeenCalledWith('llm-1', true)
    expect(mocks.focusCanvas).toHaveBeenCalledOnce()
    expect(mocks.refreshCanvas).not.toHaveBeenCalled()
  })
})
