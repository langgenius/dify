import type { WorkflowRunningData } from '../../types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

describe('useNodesSyncDraft', () => {
  it('should return doSyncWorkflowDraft, handleSyncWorkflowDraft, and syncWorkflowDraftWhenPageClose', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)
    const mockSyncClose = vi.fn()

    const { result } = renderWorkflowHook(() => useNodesSyncDraft(), {
      hooksStoreProps: {
        doSyncWorkflowDraft: mockDoSync,
        syncWorkflowDraftWhenPageClose: mockSyncClose,
      },
    })

    expect(result.current.doSyncWorkflowDraft).toBe(mockDoSync)
    expect(result.current.syncWorkflowDraftWhenPageClose).toBe(mockSyncClose)
    expect(typeof result.current.handleSyncWorkflowDraft).toBe('function')
  })

  it('should call doSyncWorkflowDraft synchronously when sync=true', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)

    const { result } = renderWorkflowHook(() => useNodesSyncDraft(), {
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    const callback = { onSuccess: vi.fn() }
    result.current.handleSyncWorkflowDraft(true, false, callback)

    expect(mockDoSync).toHaveBeenCalledWith(false, callback)
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
        workflowRunningData: {
          result: { status: WorkflowRunningStatus.Running },
        } as WorkflowRunningData,
      },
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    result.current.handleSyncWorkflowDraft(true)

    expect(mockDoSync).not.toHaveBeenCalled()
  })

  it('should pass notRefreshWhenSyncError to doSyncWorkflowDraft', () => {
    const mockDoSync = vi.fn().mockResolvedValue(undefined)

    const { result } = renderWorkflowHook(() => useNodesSyncDraft(), {
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    })

    result.current.handleSyncWorkflowDraft(true, true)

    expect(mockDoSync).toHaveBeenCalledWith(true, undefined)
  })
})
