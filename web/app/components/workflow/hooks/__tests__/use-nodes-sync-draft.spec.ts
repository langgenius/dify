import { baseRunningData, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

describe('useNodesSyncDraft', () => {
  it('should call doSyncWorkflowDraft synchronously when sync=true', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)

    const { result } = renderWorkflowHook(() => useNodesSyncDraft(), {
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    const callback = { onSuccess: vi.fn() }
    result.current.handleSyncWorkflowDraft(true, true, callback)

    expect(mockDoSync).toHaveBeenCalledWith(true, callback)
  })

  it('should use debounced path when sync is falsy, then flush triggers doSync', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)

    const { result, store } = renderWorkflowHook(() => useNodesSyncDraft(), {
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    result.current.handleSyncWorkflowDraft()

    expect(mockDoSync).not.toHaveBeenCalled()

    store.getState().flushPendingSync()
    expect(mockDoSync).toHaveBeenCalledOnce()
  })

  it('should do nothing when nodes are read-only (workflow running)', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)

    const { result } = renderWorkflowHook(() => useNodesSyncDraft(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Running } }),
      },
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    result.current.handleSyncWorkflowDraft(true)

    expect(mockDoSync).not.toHaveBeenCalled()
  })
})
