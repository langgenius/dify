import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../types'
import { useNodesInteractionsWithoutSync } from '../use-nodes-interactions-without-sync'

type NodeRuntimeState = {
  _runningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

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

describe('useNodesInteractionsWithoutSync', () => {
  it('clears _runningStatus and _waitingRun on all nodes', async () => {
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

  it('clears _runningStatus only for Succeeded nodes', async () => {
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

  it('does not modify _waitingRun when clearing all success status', async () => {
    const { result } = renderNodesInteractionsHook()

    act(() => {
      result.current.handleCancelAllNodeSuccessStatus()
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n1'))._waitingRun).toBe(true)
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n3'))._waitingRun).toBe(true)
    })
  })

  it('clears _runningStatus and _waitingRun for the specified succeeded node', async () => {
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

  it('does not modify nodes that are not succeeded', async () => {
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

  it('does not modify other nodes', async () => {
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
