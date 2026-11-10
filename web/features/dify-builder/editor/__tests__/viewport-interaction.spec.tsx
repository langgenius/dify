import { act } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow-app/__tests__/workflow-test-env'
import {
  selectWorkflowNode,
  setupNodeSelectionListener,
} from '@/app/components/workflow/utils/node-navigation'
import { useDifyBuilderViewportInteraction } from '../use-viewport-interaction'

it('cancels queued node focus when users navigate after the edit lock is released', () => {
  vi.useFakeTimers()
  const scroll = vi.fn()
  document.addEventListener('workflow:scroll-to-node', scroll)
  const { result, store } = renderWorkflowHook(() => useDifyBuilderViewportInteraction())
  const cleanupSelection = setupNodeSelectionListener(() => {})
  try {
    selectWorkflowNode('generated', true, () => !store.getState().builderViewportManuallyChanged)
    act(() => {
      result.current()
      vi.advanceTimersByTime(100)
    })
    expect(scroll).not.toHaveBeenCalled()
  } finally {
    cleanupSelection()
    document.removeEventListener('workflow:scroll-to-node', scroll)
    vi.useRealTimers()
  }
})
