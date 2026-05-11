import type { HistoryWorkflowData } from '../../types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowMode } from '../use-workflow-mode'

describe('useWorkflowMode', () => {
  it('should return normal mode when no history data and not restoring', () => {
    const { result } = renderWorkflowHook(() => useWorkflowMode())

    expect(result.current.normal).toBe(true)
    expect(result.current.restoring).toBe(false)
    expect(result.current.viewHistory).toBe(false)
  })

  it('should return restoring mode when isRestoring is true', () => {
    const { result } = renderWorkflowHook(() => useWorkflowMode(), {
      initialStoreState: { isRestoring: true },
    })

    expect(result.current.normal).toBe(false)
    expect(result.current.restoring).toBe(true)
    expect(result.current.viewHistory).toBe(false)
  })

  it('should return viewHistory mode when historyWorkflowData exists', () => {
    const { result } = renderWorkflowHook(() => useWorkflowMode(), {
      initialStoreState: {
        historyWorkflowData: { id: 'v1', status: 'succeeded' } as HistoryWorkflowData,
      },
    })

    expect(result.current.normal).toBe(false)
    expect(result.current.restoring).toBe(false)
    expect(result.current.viewHistory).toBe(true)
  })

  it('should prioritize restoring over viewHistory when both are set', () => {
    const { result } = renderWorkflowHook(() => useWorkflowMode(), {
      initialStoreState: {
        isRestoring: true,
        historyWorkflowData: { id: 'v1', status: 'succeeded' } as HistoryWorkflowData,
      },
    })

    expect(result.current.restoring).toBe(true)
    expect(result.current.normal).toBe(false)
  })
})
