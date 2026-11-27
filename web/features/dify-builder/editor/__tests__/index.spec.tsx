import type { SessionRunEvents } from '../../session/types'
import type { SessionView } from '../../types'
import type { WorkflowDraftRefreshResult } from '@/features/dify-builder/editor/use-canvas-refresh'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DifyBuilderProvider } from '..'
import { builderModel, createBuilderQueryClient } from '../../__tests__/model-fixtures'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../../session/state'
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
} from '../../state'

const mocks = vi.hoisted(() => ({
  editTargetNodeIds: [] as string[],
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
  setBuilderEditTargetNodeIds: vi.fn(),
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
vi.mock('../use-run-events', () => ({ useDifyBuilderRunEvents: () => runEvents }))

vi.mock('../../session/use-session-controller', () => ({
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
      builderEditTargetNodeIds: mocks.editTargetNodeIds,
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      setBuilderEditTargetNodeIds: mocks.setBuilderEditTargetNodeIds,
      setBuilderViewportManuallyChanged: mocks.setBuilderViewportManuallyChanged,
    }),
  }),
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      setBuilderEditTargetNodeIds: typeof mocks.setBuilderEditTargetNodeIds
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      setBuilderEditTargetNodeIds: mocks.setBuilderEditTargetNodeIds,
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
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setSessionView = (view: SessionView | null) => {
    setView(view)
    const events = mocks.controllerHook.mock.lastCall![1]
    if (view) events.onSessionStateChanged?.(view)
    else events.reset()
  }
  const startPrompt = useSetAtom(difyBuilderStartPromptAtom)
  const startRunFix = useSetAtom(difyBuilderStartRunFixAtom)
  const [draft, setDraft] = useAtom(difyBuilderDraftAtom)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setBusy(true)
          mocks.controllerHook.mock.lastCall![1].onCommandStarted?.()
        }}
      >
        Start command
      </button>
      <button
        type="button"
        onClick={() => {
          setBusy(false)
          mocks.controllerHook.mock.lastCall![1].finishCommand()
        }}
      >
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
            event: 'edit_targets_changed',
            node_ids: ['llm-1'],
            operation_id: 'operation-1',
            revision: 1,
            session_id: 'session-1',
          })
        }
      >
        Mark edit targets
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

describe('DifyBuilderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.editTargetNodeIds = []
    mocks.setBuilderEditTargetNodeIds.mockImplementation((nodeIds: string[]) => {
      mocks.editTargetNodeIds = nodeIds
    })
    mocks.refreshCanvas.mockReset().mockResolvedValue('refreshed')
    mocks.restore.mockReset().mockResolvedValue(true)
    mocks.startBuild.mockReset().mockResolvedValue(true)
    mocks.syncDraft.mockReset().mockResolvedValue(undefined)
    window.sessionStorage.clear()
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
})
