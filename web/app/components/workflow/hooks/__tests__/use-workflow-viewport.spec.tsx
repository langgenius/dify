import { act } from '@testing-library/react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { selectWorkflowNode, setupNodeSelectionListener } from '../../utils/node-navigation'
import { useWorkflowViewport } from '../use-workflow-viewport'

const interrupt = vi.hoisted(() => vi.fn())
vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => ({ d3Selection: { interrupt } }) }),
}))

it('cancels a queued Builder focus when users navigate after the edit lock is released', () => {
  vi.useFakeTimers()
  const scroll = vi.fn()
  document.addEventListener('workflow:scroll-to-node', scroll)
  const { result, store } = renderWorkflowHook(() => useWorkflowViewport(), {
    initialStoreState: { canvasReadOnly: true, workflowDraftSyncPhase: 'builder' },
  })
  const cleanupSelection = setupNodeSelectionListener(() => {})
  try {
    selectWorkflowNode('generated', true, () => !store.getState().builderViewportManuallyChanged)
    act(() => {
      store.setState({ canvasReadOnly: false, workflowDraftSyncPhase: 'idle' })
      result.current.handleViewportUserInteraction()
      vi.advanceTimersByTime(100)
    })

    expect(scroll).not.toHaveBeenCalled()
    expect(interrupt).toHaveBeenCalledOnce()
  } finally {
    cleanupSelection()
    document.removeEventListener('workflow:scroll-to-node', scroll)
    vi.useRealTimers()
  }
})
