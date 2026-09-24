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
  refresh: (shouldApply: () => boolean) => Promise<boolean>
  refreshed: () => void
}) => {
  const canvas = useDifyBuilderCanvasEvents(() => undefined)
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
  refresh = vi.fn<(shouldApply: () => boolean) => Promise<boolean>>().mockResolvedValue(true),
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
  return { store, refresh, refreshed, user: userEvent.setup() }
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
      canvasEvent('mark_review_ready'),
    ])

    await user.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect(selection).toHaveBeenCalledTimes(2)
    expect(selection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ detail: { nodeId: 'start', focus: true } }),
    )
    expect(selection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ detail: { nodeId: 'answer', focus: true } }),
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
      .fn<(shouldApply: () => boolean) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const { user, store, refreshed } = setup(
      [
        canvasEvent('add_llm_node', 'answer'),
        canvasEvent('apply_edit_plan'),
        canvasEvent('mark_review_ready'),
      ],
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
      expect.objectContaining({ detail: { nodeId: 'answer', focus: true } }),
    )
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(store.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(store.get(difyBuilderCanvasPendingRefreshAtom)).toBeNull()
  })

  it('discards pending focus and refresh completion when the session resets', async () => {
    let resolveRefresh!: (value: boolean) => void
    const refresh = vi.fn<(shouldApply: () => boolean) => Promise<boolean>>().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const { user, store, refreshed } = setup([canvasEvent('add_llm_node', 'answer')], refresh)
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    await user.click(screen.getByRole('button', { name: 'Finish command' }))
    expect(refresh).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Reset session' }))
    await act(async () => resolveRefresh(true))

    expect(refresh.mock.calls[0]![0]()).toBe(false)
    expect(selection).not.toHaveBeenCalled()
    expect(refreshed).not.toHaveBeenCalled()
    expect(store.get(difyBuilderCanvasPendingRefreshAtom)).toBeNull()
  })
})
