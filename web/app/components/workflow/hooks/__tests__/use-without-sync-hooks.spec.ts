import { act, waitFor } from '@testing-library/react'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../types'
import { useEdgesInteractionsWithoutSync } from '../use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '../use-nodes-interactions-without-sync'

type EdgeRuntimeState = {
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

type NodeRuntimeState = {
  _runningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

describe('useEdgesInteractionsWithoutSync', () => {
  const createFlowNodes = () => [
    createNode({ id: 'a' }),
    createNode({ id: 'b' }),
    createNode({ id: 'c' }),
  ]
  const createFlowEdges = () => [
    createEdge({
      id: 'e1',
      source: 'a',
      target: 'b',
      data: {
        _sourceRunningStatus: NodeRunningStatus.Running,
        _targetRunningStatus: NodeRunningStatus.Running,
        _waitingRun: true,
      },
    }),
    createEdge({
      id: 'e2',
      source: 'b',
      target: 'c',
      data: {
        _sourceRunningStatus: NodeRunningStatus.Succeeded,
        _targetRunningStatus: undefined,
        _waitingRun: false,
      },
    }),
  ]

  const renderEdgesInteractionsHook = () =>
    renderWorkflowFlowHook(() => ({
      ...useEdgesInteractionsWithoutSync(),
      edges: useEdges(),
    }), {
      nodes: createFlowNodes(),
      edges: createFlowEdges(),
    })

  it('should clear running status and waitingRun on all edges', () => {
    const { result } = renderEdgesInteractionsHook()

    act(() => {
      result.current.handleEdgeCancelRunningStatus()
    })

    return waitFor(() => {
      result.current.edges.forEach((edge) => {
        const edgeState = getEdgeRuntimeState(edge)
        expect(edgeState._sourceRunningStatus).toBeUndefined()
        expect(edgeState._targetRunningStatus).toBeUndefined()
        expect(edgeState._waitingRun).toBe(false)
      })
    })
  })

  it('should not mutate original edges', () => {
    const edges = createFlowEdges()
    const originalData = { ...getEdgeRuntimeState(edges[0]) }
    const { result } = renderWorkflowFlowHook(() => ({
      ...useEdgesInteractionsWithoutSync(),
      edges: useEdges(),
    }), {
      nodes: createFlowNodes(),
      edges,
    })

    act(() => {
      result.current.handleEdgeCancelRunningStatus()
    })

    expect(getEdgeRuntimeState(edges[0])._sourceRunningStatus).toBe(originalData._sourceRunningStatus)
  })
})

describe('useNodesInteractionsWithoutSync', () => {
  const createFlowNodes = () => [
    createNode({ id: 'n1', data: { _runningStatus: NodeRunningStatus.Running, _waitingRun: true } }),
    createNode({ id: 'n2', position: { x: 100, y: 0 }, data: { _runningStatus: NodeRunningStatus.Succeeded, _waitingRun: false } }),
    createNode({ id: 'n3', position: { x: 200, y: 0 }, data: { _runningStatus: NodeRunningStatus.Failed, _waitingRun: true } }),
  ]

  const renderNodesInteractionsHook = () =>
    renderWorkflowFlowHook(() => ({
      ...useNodesInteractionsWithoutSync(),
      nodes: useNodes(),
    }), {
      nodes: createFlowNodes(),
      edges: [],
    })

  describe('handleNodeCancelRunningStatus', () => {
    it('should clear _runningStatus and _waitingRun on all nodes', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleNodeCancelRunningStatus()
      })

      await waitFor(() => {
        result.current.nodes.forEach((node) => {
          const nodeState = getNodeRuntimeState(node)
          expect(nodeState._runningStatus).toBeUndefined()
          expect(nodeState._waitingRun).toBe(false)
        })
      })
    })
  })

  describe('handleCancelAllNodeSuccessStatus', () => {
    it('should clear _runningStatus only for Succeeded nodes', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleCancelAllNodeSuccessStatus()
      })

      await waitFor(() => {
        const n1 = result.current.nodes.find(node => node.id === 'n1')
        const n2 = result.current.nodes.find(node => node.id === 'n2')
        const n3 = result.current.nodes.find(node => node.id === 'n3')

        expect(getNodeRuntimeState(n1)._runningStatus).toBe(NodeRunningStatus.Running)
        expect(getNodeRuntimeState(n2)._runningStatus).toBeUndefined()
        expect(getNodeRuntimeState(n3)._runningStatus).toBe(NodeRunningStatus.Failed)
      })
    })

    it('should not modify _waitingRun', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleCancelAllNodeSuccessStatus()
      })

      await waitFor(() => {
        expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n1'))._waitingRun).toBe(true)
        expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n3'))._waitingRun).toBe(true)
      })
    })
  })

  describe('handleCancelNodeSuccessStatus', () => {
    it('should clear _runningStatus and _waitingRun for the specified Succeeded node', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleCancelNodeSuccessStatus('n2')
      })

      await waitFor(() => {
        const n2 = result.current.nodes.find(node => node.id === 'n2')
        expect(getNodeRuntimeState(n2)._runningStatus).toBeUndefined()
        expect(getNodeRuntimeState(n2)._waitingRun).toBe(false)
      })
    })

    it('should not modify nodes that are not Succeeded', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleCancelNodeSuccessStatus('n1')
      })

      await waitFor(() => {
        const n1 = result.current.nodes.find(node => node.id === 'n1')
        expect(getNodeRuntimeState(n1)._runningStatus).toBe(NodeRunningStatus.Running)
        expect(getNodeRuntimeState(n1)._waitingRun).toBe(true)
      })
    })

    it('should not modify other nodes', async () => {
      const { result } = renderNodesInteractionsHook()

      act(() => {
        result.current.handleCancelNodeSuccessStatus('n2')
      })

      await waitFor(() => {
        const n1 = result.current.nodes.find(node => node.id === 'n1')
        expect(getNodeRuntimeState(n1)._runningStatus).toBe(NodeRunningStatus.Running)
      })
    })
  })
})
