import type { WorkflowDraftRefreshResult } from '../../../hooks/use-workflow-refresh-draft'
import type { CanvasEventData } from '../types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useSetAtom } from 'jotai'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { DifyBuilderCanvasRefreshSync } from '../provider/canvas-sync'
import { useDifyBuilderCanvasEvents } from '../provider/use-canvas-events'
import { createSessionView } from '../session/__tests__/fixtures'
import { difyBuilderSessionBusyAtom, difyBuilderSessionViewAtom } from '../session/state'
import {
  difyBuilderCanvasPendingRefreshAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderRetryCanvasRefreshAtom,
} from '../store'

const canvasEvent = (event: CanvasEventData['event'], nodeId?: string): CanvasEventData => ({
  session_id: 'session-1',
  operation_id: 'operation-1',
  at_version: 2,
  revision: 1,
  event,
  node_id: nodeId,
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
  const setBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const retry = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
  return (
    <>
      <button type="button" onClick={() => events.forEach(canvas.onCanvasEvent)}>
        Apply changes
      </button>
      <button type="button" onClick={() => setBusy(false)}>
        Finish command
      </button>
      <button type="button" onClick={() => retry()}>
        Retry refresh
      </button>
      <button
        type="button"
        onClick={() => {
          canvas.reset()
          setView(null)
          setBusy(false)
        }}
      >
        Reset session
      </button>
      <DifyBuilderCanvasRefreshSync onRefreshCanvas={refresh} onCanvasRefreshed={refreshed} />
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
    }),
  )
  store.set(difyBuilderSessionBusyAtom, true)
  const workflow = createWorkflowStore({})
  const refreshed = vi.fn()
  render(
    <Provider store={store}>
      <WorkflowContext value={workflow}>
        <Harness events={events} refresh={refresh} refreshed={refreshed} />
      </WorkflowContext>
    </Provider>,
  )
  return { store, workflow, refresh, refreshed, user: userEvent.setup() }
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

  it('handles every highlight in a batch and coalesces its graph refresh', async () => {
    const { user, store, refresh, refreshed } = setup([
      canvasEvent('highlight_edit_target', 'start'),
      canvasEvent('highlight_edit_target', 'answer'),
      canvasEvent('apply_edit_plan'),
    ])

    await user.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect(selection).toHaveBeenCalledTimes(2)
    expect(selection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'start', focus: true }),
      }),
    )
    expect(selection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'answer', focus: true }),
      }),
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Finish command' }))

    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(refresh).toHaveBeenCalledOnce()
    expect(selection).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
  })

  it('retains deferred node focus through later events and a failed refresh until retry succeeds', async () => {
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('refreshed')
    const { user, store, refreshed } = setup(
      [canvasEvent('add_llm_node', 'answer'), canvasEvent('apply_edit_plan')],
      refresh,
    )
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(selection).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(store.get(difyBuilderCanvasRefreshFailedAtom)).toBe(true))
    expect(selection).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Retry refresh' }))

    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(selection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'answer', focus: true }),
      }),
    )
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(store.get(difyBuilderCanvasPendingRefreshAtom)).toBeNull()
  })

  it('discards pending focus and refresh completion when the session resets', async () => {
    let resolveRefresh!: (value: WorkflowDraftRefreshResult) => void
    const refresh = vi
      .fn<(shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
      )
    const { user, store, refreshed } = setup([canvasEvent('add_llm_node', 'answer')], refresh)
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

  it('keeps highlighting Builder targets without taking over a manually moved viewport', async () => {
    const { user, workflow, refreshed } = setup([
      canvasEvent('highlight_edit_target', 'start'),
      canvasEvent('add_llm_node', 'answer'),
    ])
    act(() => workflow.setState({ builderViewportManuallyChanged: true }))

    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(selection).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'start', focus: false }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'answer', focus: false }),
      }),
    )
  })

  it('retains user navigation when session startup resets the canvas event state', async () => {
    const { user, workflow } = setup([canvasEvent('highlight_edit_target', 'start')])
    act(() => workflow.setState({ builderViewportManuallyChanged: true }))

    await user.click(screen.getByRole('button', { name: 'Reset session' }))
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect(selection).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ nodeId: 'start', focus: false }),
      }),
    )
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
