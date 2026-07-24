import { renderHook } from '@testing-library/react'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { NodeRunningStatus } from '../../types'
import { useEdgesInteractionsWithoutSync } from '../use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '../use-nodes-interactions-without-sync'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

describe('useEdgesInteractionsWithoutSync', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.edges = [
      { id: 'e1', source: 'a', target: 'b', data: { _sourceRunningStatus: 'running', _targetRunningStatus: 'running', _waitingRun: true } },
      { id: 'e2', source: 'b', target: 'c', data: { _sourceRunningStatus: 'succeeded', _targetRunningStatus: undefined, _waitingRun: false } },
    ]
  })

  it('should clear running status and waitingRun on all edges', () => {
    const { result } = renderHook(() => useEdgesInteractionsWithoutSync())

    result.current.handleEdgeCancelRunningStatus()

    expect(rfState.setEdges).toHaveBeenCalledOnce()
    const updated = rfState.setEdges.mock.calls[0][0]
    for (const edge of updated) {
      expect(edge.data._sourceRunningStatus).toBeUndefined()
      expect(edge.data._targetRunningStatus).toBeUndefined()
      expect(edge.data._waitingRun).toBe(false)
    }
  })

  it('should not mutate original edges', () => {
    const originalData = { ...rfState.edges[0].data }
    const { result } = renderHook(() => useEdgesInteractionsWithoutSync())

    result.current.handleEdgeCancelRunningStatus()

    expect(rfState.edges[0].data._sourceRunningStatus).toBe(originalData._sourceRunningStatus)
  })
})

describe('useNodesInteractionsWithoutSync', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running, _waitingRun: true } },
      { id: 'n2', position: { x: 100, y: 0 }, data: { _runningStatus: NodeRunningStatus.Succeeded, _waitingRun: false } },
      { id: 'n3', position: { x: 200, y: 0 }, data: { _runningStatus: NodeRunningStatus.Failed, _waitingRun: true } },
    ]
  })

  describe('handleNodeCancelRunningStatus', () => {
    it('should clear _runningStatus and _waitingRun on all nodes', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleNodeCancelRunningStatus()

      expect(rfState.setNodes).toHaveBeenCalledOnce()
      const updated = rfState.setNodes.mock.calls[0][0]
      for (const node of updated) {
        expect(node.data._runningStatus).toBeUndefined()
        expect(node.data._waitingRun).toBe(false)
      }
    })
  })

  describe('handleCancelAllNodeSuccessStatus', () => {
    it('should clear _runningStatus only for Succeeded nodes', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleCancelAllNodeSuccessStatus()

      expect(rfState.setNodes).toHaveBeenCalledOnce()
      const updated = rfState.setNodes.mock.calls[0][0]
      const n1 = updated.find((n: { id: string }) => n.id === 'n1')
      const n2 = updated.find((n: { id: string }) => n.id === 'n2')
      const n3 = updated.find((n: { id: string }) => n.id === 'n3')

      expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
      expect(n2.data._runningStatus).toBeUndefined()
      expect(n3.data._runningStatus).toBe(NodeRunningStatus.Failed)
    })

    it('should not modify _waitingRun', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleCancelAllNodeSuccessStatus()

      const updated = rfState.setNodes.mock.calls[0][0]
      expect(updated.find((n: { id: string }) => n.id === 'n1').data._waitingRun).toBe(true)
      expect(updated.find((n: { id: string }) => n.id === 'n3').data._waitingRun).toBe(true)
    })
  })

  describe('handleCancelNodeSuccessStatus', () => {
    it('should clear _runningStatus and _waitingRun for the specified Succeeded node', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleCancelNodeSuccessStatus('n2')

      expect(rfState.setNodes).toHaveBeenCalledOnce()
      const updated = rfState.setNodes.mock.calls[0][0]
      const n2 = updated.find((n: { id: string }) => n.id === 'n2')
      expect(n2.data._runningStatus).toBeUndefined()
      expect(n2.data._waitingRun).toBe(false)
    })

    it('should not modify nodes that are not Succeeded', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleCancelNodeSuccessStatus('n1')

      const updated = rfState.setNodes.mock.calls[0][0]
      const n1 = updated.find((n: { id: string }) => n.id === 'n1')
      expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
      expect(n1.data._waitingRun).toBe(true)
    })

    it('should not modify other nodes', () => {
      const { result } = renderHook(() => useNodesInteractionsWithoutSync())

      result.current.handleCancelNodeSuccessStatus('n2')

      const updated = rfState.setNodes.mock.calls[0][0]
      const n1 = updated.find((n: { id: string }) => n.id === 'n1')
      expect(n1.data._runningStatus).toBe(NodeRunningStatus.Running)
    })
  })
})
