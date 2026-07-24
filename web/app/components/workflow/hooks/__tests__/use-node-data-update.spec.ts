import type { WorkflowRunningData } from '../../types'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import { useNodeDataUpdate } from '../use-node-data-update'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

describe('useNodeDataUpdate', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Node 1', value: 'original' } },
      { id: 'node-2', position: { x: 300, y: 0 }, data: { title: 'Node 2' } },
    ]
  })

  describe('handleNodeDataUpdate', () => {
    it('should merge data into the target node and call setNodes', () => {
      const { result } = renderWorkflowHook(() => useNodeDataUpdate(), {
        hooksStoreProps: {},
      })

      result.current.handleNodeDataUpdate({
        id: 'node-1',
        data: { value: 'updated', extra: true },
      })

      expect(rfState.setNodes).toHaveBeenCalledOnce()
      const updatedNodes = rfState.setNodes.mock.calls[0][0]
      expect(updatedNodes.find((n: { id: string }) => n.id === 'node-1').data).toEqual({
        title: 'Node 1',
        value: 'updated',
        extra: true,
      })
      expect(updatedNodes.find((n: { id: string }) => n.id === 'node-2').data).toEqual({
        title: 'Node 2',
      })
    })
  })

  describe('handleNodeDataUpdateWithSyncDraft', () => {
    it('should update node data and trigger debounced sync draft', () => {
      const mockDoSync = vi.fn().mockResolvedValue(undefined)

      const { result, store } = renderWorkflowHook(() => useNodeDataUpdate(), {
        hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
      })

      result.current.handleNodeDataUpdateWithSyncDraft({
        id: 'node-1',
        data: { value: 'synced' },
      })

      expect(rfState.setNodes).toHaveBeenCalledOnce()

      store.getState().flushPendingSync()
      expect(mockDoSync).toHaveBeenCalledOnce()
    })

    it('should call doSyncWorkflowDraft directly when sync=true', () => {
      const mockDoSync = vi.fn().mockResolvedValue(undefined)
      const callback = { onSuccess: vi.fn() }

      const { result } = renderWorkflowHook(() => useNodeDataUpdate(), {
        hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
      })

      result.current.handleNodeDataUpdateWithSyncDraft(
        { id: 'node-1', data: { value: 'synced' } },
        { sync: true, notRefreshWhenSyncError: true, callback },
      )

      expect(mockDoSync).toHaveBeenCalledWith(true, callback)
    })

    it('should do nothing when nodes are read-only', () => {
      const mockDoSync = vi.fn().mockResolvedValue(undefined)

      const { result } = renderWorkflowHook(() => useNodeDataUpdate(), {
        initialStoreState: {
          workflowRunningData: {
            result: { status: WorkflowRunningStatus.Running },
          } as WorkflowRunningData,
        },
        hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
      })

      result.current.handleNodeDataUpdateWithSyncDraft({
        id: 'node-1',
        data: { value: 'should-not-update' },
      })

      expect(rfState.setNodes).not.toHaveBeenCalled()
      expect(mockDoSync).not.toHaveBeenCalled()
    })
  })
})
