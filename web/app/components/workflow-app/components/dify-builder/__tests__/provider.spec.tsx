import type { WorkflowDraftRefreshResult } from '../../../hooks/use-workflow-refresh-draft'
import type { SessionRunEvents } from '../session/types'
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
  difyBuilderSessionViewAtom,
} from '../session/state'
import {
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderErrorAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderStartPromptAtom,
  difyBuilderStartRunFixAtom,
} from '../store'
import { builderModel, createBuilderQueryClient } from './model-fixtures'

const mocks = vi.hoisted(() => ({
  controllerHook:
    vi.fn<(prepare: (saveDraft: boolean) => Promise<void>, events: SessionRunEvents) => void>(),
  refreshCanvas: vi.fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>(
    async () => 'refreshed',
  ),
  reset: vi.fn(),
  restore: vi.fn(async () => true),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  setCanvasReadOnly: vi.fn(),
  setBuilderViewportManuallyChanged: vi.fn(),
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

const runEvents = vi.hoisted(() => ({
  onWorkflowEvent: vi.fn(),
  onStreamInterrupted: vi.fn(),
  onCanvasEvent: vi.fn(),
  restoreRun: vi.fn(),
  finishCommand: vi.fn(),
  reset: vi.fn(),
  onCanvasRefreshed: vi.fn(),
}))
vi.mock('../provider/use-run-events', () => ({ useDifyBuilderRunEvents: () => runEvents }))

vi.mock('../session/use-session-controller', () => ({
  useDifyBuilderSessionController: (
    prepareCommand: (saveDraft: boolean) => Promise<void>,
    events: SessionRunEvents,
  ) => {
    mocks.controllerHook(prepareCommand, events)
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
      onCanvasRefreshed: runEvents.onCanvasRefreshed,
    }
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      builderViewportManuallyChanged: false,
      setBuilderViewportManuallyChanged: mocks.setBuilderViewportManuallyChanged,
    }),
  }),
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      setShowDifyBuilderPanel: mocks.setShowPanel,
    }),
}))

const Probe = () => {
  const canvasRefreshFailed = useAtomValue(difyBuilderCanvasRefreshFailedAtom)
  const canvasRefreshGeneration = useAtomValue(difyBuilderCanvasRefreshGenerationAtom)
  const canvasRefreshing = useAtomValue(difyBuilderCanvasRefreshingAtom)
  const localError = useAtomValue(difyBuilderErrorAtom)
  const recheckReady = useAtomValue(difyBuilderRecheckReadyAtom)
  const registerChecklistErrors = useSetAtom(difyBuilderRegisterChecklistErrorsAtom)
  const retryCanvasRefresh = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
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
      <button
        type="button"
        onClick={() => void startPrompt({ text: 'Build a support bot', model: builderModel })}
      >
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
            canvas_read_only: true,
            conversation_last_seq: -1,
            interrupted: false,
            phase: 'understand',
            run_status: 'processing',
            reply_language: '',
            session_id: 'session-1',
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
            canvas_read_only: false,
            conversation_last_seq: -1,
            interrupted: false,
            phase: 'test',
            run_status: 'waiting_input',
            reply_language: '',
            session_id: 'session-1',
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
          mocks.controllerHook.mock.lastCall![1].onCanvasEvent({
            at_version: 2,
            event: 'highlight_edit_target',
            node_id: 'llm-1',
            operation_id: 'operation-1',
            revision: 1,
            session_id: 'session-1',
          })
        }
      >
        Focus event node
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
      getCanvasSnapshot={() => ({
        nodes: [],
        edges: Array.from({ length: edgeCount }, () => ({ source: 'start', target: 'llm' })),
        isChatflow: false,
      })}
      onRefreshCanvas={mocks.refreshCanvas}
      onSyncDraft={mocks.syncDraft}
      tenantId="workspace-1"
      userId={userId}
    >
      <Probe />
    </DifyBuilderProvider>,
    {
      queryClient: createBuilderQueryClient(),
      features: { dify_builder_enabled: difyBuilderEnabled },
    },
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
          getCanvasSnapshot={() => ({ nodes: [], edges: [], isChatflow: false })}
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
    mocks.refreshCanvas.mockReset().mockResolvedValue('refreshed')
    mocks.restore.mockReset().mockResolvedValue(true)
    mocks.startBuild.mockReset().mockResolvedValue(true)
    mocks.syncDraft.mockReset().mockResolvedValue(undefined)
    window.sessionStorage.clear()
  })

  it('starts a build session for an empty canvas', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(mocks.startBuild).toHaveBeenCalledWith('app-1', 'Build a support bot', builderModel)
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
        queryClient: createBuilderQueryClient(),
        features: { dify_builder_enabled: true },
      },
    )

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense workflow',
        builderModel,
      ),
    )
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
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
    renderWithConsoleQuery(<CreationNavigation />, {
      queryClient: createBuilderQueryClient(),
      features: { dify_builder_enabled: true },
    })

    await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

    await waitFor(() => expect(mocks.startBuild).toHaveBeenCalledOnce())
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue(
      'Build an expense workflow',
    )
  })

  it('passes the editor draft coordinator to the session controller', () => {
    renderProvider()
    expect(mocks.controllerHook).toHaveBeenCalledWith(
      mocks.syncDraft,
      expect.objectContaining({
        onCanvasEvent: expect.any(Function),
      }),
    )
  })

  it.each([
    { error: new Error('Connection failed.'), reason: 'Connection failed.' },
    { error: { data: { body: { message: 'Access denied.' } } }, reason: 'Access denied.' },
    {
      error: new Response('{"message":"Service unavailable."}', { status: 503 }),
      reason: 'HTTP 503: Service unavailable.',
    },
    { error: {}, reason: '' },
  ])(
    'restores the creation prompt and formats the startup error: $reason',
    async ({ error, reason }) => {
      mocks.startBuild.mockRejectedValueOnce(error)
      const user = userEvent.setup()
      renderWithConsoleQuery(<CreationNavigation />, {
        queryClient: createBuilderQueryClient(),
        features: { dify_builder_enabled: true },
      })

      await user.click(screen.getByRole('button', { name: 'Create with Builder' }))

      expect(screen.getByRole('textbox', { name: 'Builder draft' })).toHaveValue(
        'Build an expense workflow',
      )
      const message = screen.getByRole('status', { name: 'Canvas refresh error' })
      await waitFor(() => expect(message).toHaveTextContent('difyBuilder.creationStartFailed'))
      if (reason) expect(message).toHaveTextContent(reason)
      expect(message).not.toHaveTextContent('[object Object]')
      expect(message).not.toHaveTextContent('Error:')
    },
  )

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
      renderWithConsoleQuery(<CreationNavigation />, {
        queryClient: createBuilderQueryClient(),
        features: { dify_builder_enabled: true },
      })

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
        queryClient: createBuilderQueryClient(),
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

    expect(mocks.startEdit).toHaveBeenCalledWith('app-1', 'Build a support bot', builderModel)
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

  it('locks the canvas while a Builder command is preparing or running', async () => {
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'Start command' }))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Stream update' }))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(true)
  })

  it('prevents an in-flight canvas refresh from applying after session reset', async () => {
    let resolveResponse!: (value: WorkflowDraftRefreshResult) => void
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
    await act(async () => resolveResponse('refreshed'))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
  })

  it('retries an interrupted refresh even when the command returns the same session version', async () => {
    let resolveRefresh!: (value: WorkflowDraftRefreshResult) => void
    mocks.refreshCanvas.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'Refresh update' }))
    await user.click(screen.getByRole('button', { name: 'Start command' }))
    await act(async () => resolveRefresh('superseded'))
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledTimes(2))
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
  })

  it('keeps recheck blocked until a refreshed canvas is evaluated', async () => {
    let resolveRefresh: (refreshed: WorkflowDraftRefreshResult) => void = () => undefined
    mocks.refreshCanvas.mockImplementationOnce(
      () =>
        new Promise<WorkflowDraftRefreshResult>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Refresh update' }))

    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledOnce())
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await act(async () => resolveRefresh('refreshed'))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Refresh generation' })).toHaveTextContent('1'),
    )
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Register checklist' }))

    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('true')
  })

  it('reports a failed refresh and advances generation only after retry succeeds', async () => {
    let resolveRetry: (refreshed: WorkflowDraftRefreshResult) => void = () => undefined
    mocks.refreshCanvas.mockResolvedValueOnce('failed').mockImplementationOnce(
      () =>
        new Promise<WorkflowDraftRefreshResult>((resolve) => {
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
      'difyBuilder.canvasRefreshFailed',
    )
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Retry canvas refresh' }))

    await waitFor(() => expect(mocks.refreshCanvas).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status', { name: 'Canvas refreshing' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await act(async () => resolveRetry('refreshed'))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Refresh generation' })).toHaveTextContent('1'),
    )
    expect(screen.getByRole('status', { name: 'Canvas refresh failed' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Register checklist' }))

    expect(screen.getByRole('status', { name: 'Recheck ready' })).toHaveTextContent('true')
  })

  it('formats a rejected canvas refresh with localized copy and the response message', async () => {
    mocks.refreshCanvas.mockRejectedValueOnce({ data: { body: { message: 'Connection lost.' } } })
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Refresh update' }))

    const message = screen.getByRole('status', { name: 'Canvas refresh error' })
    await waitFor(() => expect(message).toHaveTextContent('difyBuilder.canvasRefreshFailed'))
    expect(message).toHaveTextContent('Connection lost.')
    expect(message).not.toHaveTextContent('[object Object]')
  })

  it('highlights the edit target without refreshing the draft', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Focus event node' }))

    expect(mocks.selectWorkflowNode).toHaveBeenCalledWith('llm-1', true, expect.any(Function))
    expect(mocks.refreshCanvas).not.toHaveBeenCalled()
  })
})
