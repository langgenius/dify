import type { CanvasEventData } from '../../types'
import type { WorkflowDraftRefreshResult } from '@/features/dify-builder/editor/use-canvas-refresh'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { createWorkflowAppStore as createWorkflowStore } from '@/app/components/workflow-app/__tests__/workflow-store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { createSessionView } from '../../session/__tests__/fixtures'
import { difyBuilderSessionBusyAtom, difyBuilderSessionViewAtom } from '../../session/state'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasPendingRefreshAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderRuntimeAtom,
} from '../../state'
import { DifyBuilderCanvasLockCleanup } from '../canvas-lock-cleanup'
import { useDifyBuilderCanvasEvents } from '../use-canvas-events'
import { useDifyBuilderCanvasRefresh } from '../use-canvas-refresh'

const canvasMetadata = {
  session_id: 'session-1',
  operation_id: 'operation-1',
  at_version: 2,
  revision: 1,
}
const graphChanged = (cause: 'apply' | 'restore' = 'apply'): CanvasEventData => ({
  ...canvasMetadata,
  event: 'graph_changed',
  cause,
})
const editTargets = (...nodeIds: string[]): CanvasEventData => ({
  ...canvasMetadata,
  event: 'edit_targets_changed',
  node_ids: nodeIds,
})

const Harness = ({
  events,
  refresh,
  refreshed,
}: {
  events: CanvasEventData[]
  refresh: (shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>
  refreshed: () => void
}) => {
  const canvas = useDifyBuilderCanvasEvents()
  const canvasRefresh = useDifyBuilderCanvasRefresh(refresh, refreshed)
  useHydrateAtoms(
    [
      [
        difyBuilderRuntimeAtom,
        createDifyBuilderRuntime({ retryCanvasRefresh: canvasRefresh.retry }),
      ],
    ],
    { dangerouslyForceHydrate: true },
  )
  const setBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const retry = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setBusy(true)
          canvasRefresh.cancel()
        }}
      >
        Start command
      </button>
      <button
        type="button"
        onClick={() =>
          events.forEach((event) => {
            canvas.onCanvasEvent(event)
            if (event.event === 'graph_changed') void canvasRefresh.refresh()
          })
        }
      >
        Apply changes
      </button>
      <button
        type="button"
        onClick={() => {
          setBusy(false)
          canvasRefresh.finishCommand()
        }}
      >
        Finish command
      </button>
      <button type="button" onClick={() => retry()}>
        Retry refresh
      </button>
      {(['test', 'complete'] as const).map((phase) => (
        <button
          key={phase}
          type="button"
          onClick={() => {
            const view = createSessionView({
              version: 3,
              phase,
              run_status: phase === 'complete' ? 'complete' : 'processing',
            })
            setView(view)
            canvas.onSessionStateChanged(view)
            void canvasRefresh.refresh()
          }}
        >
          {phase === 'test' ? 'Enter test' : 'Complete task'}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setView(null)
          setBusy(false)
          canvas.reset()
          canvasRefresh.reset()
        }}
      >
        Reset session
      </button>
      <DifyBuilderCanvasLockCleanup enabled />
      {([true, false] as const).map((locked) => (
        <button
          key={String(locked)}
          type="button"
          onClick={() => {
            setView(
              createSessionView({
                version: 2,
                phase: 'modify',
                run_status: 'waiting_input',
                canvas_read_only: locked,
              }),
            )
            void canvasRefresh.refresh()
          }}
        >
          {locked ? 'Lock canvas' : 'Unlock canvas'}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setView(
            createSessionView({
              version: 3,
              phase: 'review',
              run_status: 'waiting_input',
              canvas_read_only: false,
            }),
          )
          void canvasRefresh.refresh()
        }}
      >
        Advance session
      </button>
    </>
  )
}

const setup = (
  events: CanvasEventData[],
  refresh = vi
    .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
    .mockResolvedValue('refreshed'),
) => {
  const store = createStore()
  store.set(
    difyBuilderSessionViewAtom,
    createSessionView({
      version: 2,
      phase: 'modify',
      run_status: 'waiting_input',
      canvas_read_only: false,
    }),
  )
  store.set(difyBuilderSessionBusyAtom, true)
  const workflow = createWorkflowStore()
  const refreshed = vi.fn()
  const { unmount } = render(
    <Provider store={store}>
      <WorkflowContext value={workflow}>
        <Harness events={events} refresh={refresh} refreshed={refreshed} />
      </WorkflowContext>
    </Provider>,
  )
  return { store, workflow, refresh, refreshed, unmount, user: userEvent.setup() }
}

describe('Builder canvas commands', () => {
  const selection = vi.fn<EventListener>()

  beforeEach(() => {
    selection.mockClear()
    document.addEventListener('workflow:select-node', selection)
  })

  afterEach(() => {
    document.removeEventListener('workflow:select-node', selection)
  })

  it('retries a failed graph refresh without opening a node sidebar', async () => {
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('refreshed')
    const { user, store, workflow, refreshed } = setup([graphChanged()], refresh)
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(selection).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(store.get(difyBuilderCanvasRefreshFailedAtom)).toBe(true))
    expect(workflow.getState().canvasReadOnly).toBe(true)
    expect(selection).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Retry refresh' }))

    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(selection).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(store.get(difyBuilderCanvasPendingRefreshAtom)).toBeNull()
    expect(workflow.getState().canvasReadOnly).toBe(false)
  })

  it('discards the pending refresh completion when the session resets', async () => {
    let resolveRefresh!: (value: WorkflowDraftRefreshResult) => void
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
      )
    const { user, store, refreshed } = setup([graphChanged()], refresh)
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    expect(refresh).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Reset session' }))
    await act(async () => resolveRefresh('refreshed'))

    expect(refresh.mock.calls[0]![0]()).toBe(false)
    expect(selection).not.toHaveBeenCalled()
    expect(refreshed).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasPendingRefreshAtom)).toBeNull()
  })

  it('retains the server read-only lock after refresh and releases it on reset', async () => {
    const { user, workflow, refreshed } = setup([])
    await user.click(screen.getByRole('button', { name: 'Lock canvas' }))
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(workflow.getState().canvasReadOnly).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Reset session' }))
    expect(workflow.getState().canvasReadOnly).toBe(false)
  })

  it('refreshes a newer session version even when the draft revision is unchanged', async () => {
    const { user, store, refresh, refreshed } = setup([])
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'Advance session' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(store.get(difyBuilderCanvasAppliedViewAtom)).toEqual({
      sessionId: 'session-1',
      version: 3,
    })
  })

  it('clears the targets on rollback, then forces a draft refresh', async () => {
    const { user, workflow, refresh, refreshed } = setup([
      editTargets('start'),
      graphChanged('restore'),
    ])
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(workflow.getState().builderEditTargetNodeIds).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('automatically replaces a superseded refresh without exposing a manual retry', async () => {
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockResolvedValueOnce('superseded')
      .mockResolvedValueOnce('refreshed')
    const { user, store, refreshed } = setup([], refresh)
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(store.get(difyBuilderCanvasRefreshFailedAtom)).toBe(false)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('bounds automatic retries when every refresh is superseded', async () => {
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockResolvedValue('superseded')
    const { user, store, refreshed } = setup([], refresh)
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(store.get(difyBuilderCanvasRefreshFailedAtom)).toBe(true))
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(refreshed).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(false)
  })
})
