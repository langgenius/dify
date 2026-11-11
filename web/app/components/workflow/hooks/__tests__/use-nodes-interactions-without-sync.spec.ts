import type { CommonNodeType } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../types'
import { useNodesInteractionsWithoutSync } from '../use-nodes-interactions-without-sync'

const createFlowNodes = () => [
  createNode({ id: 'n1', data: { _runningStatus: NodeRunningStatus.Running, _waitingRun: true } }),
  createNode({
    id: 'n2',
    position: { x: 100, y: 0 },
    data: { _runningStatus: NodeRunningStatus.Succeeded, _waitingRun: false },
  }),
  createNode({
    id: 'n3',
    position: { x: 200, y: 0 },
    data: { _runningStatus: NodeRunningStatus.Failed, _waitingRun: true },
  }),
]

const renderNodesInteractionsHook = () =>
  renderWorkflowFlowHook(
    () => ({
      ...useNodesInteractionsWithoutSync(),
      nodes: useNodes<CommonNodeType>(),
    }),
    {
      nodes: createFlowNodes(),
      edges: [],
    },
  )

describe('useNodesInteractionsWithoutSync', () => {
  it('clears _runningStatus and _waitingRun on all nodes', async () => {
    const { result } = renderNodesInteractionsHook()

    act(() => {
      result.current.handleNodeCancelRunningStatus()
    })

    await waitFor(() => {
      result.current.nodes.forEach((node) => {
        const nodeState = node.data
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
      const n1 = result.current.nodes.find((node) => node.id === 'n1')
      const n2 = result.current.nodes.find((node) => node.id === 'n2')
      const n3 = result.current.nodes.find((node) => node.id === 'n3')

      expect(n1!.data._runningStatus).toBe(NodeRunningStatus.Running)
      expect(n2!.data._runningStatus).toBeUndefined()
      expect(n3!.data._runningStatus).toBe(NodeRunningStatus.Failed)
      expect(n1!.data._waitingRun).toBe(true)
      expect(n3!.data._waitingRun).toBe(true)
    })
  })

  it('clears _runningStatus and _waitingRun for the specified succeeded node', async () => {
    const { result } = renderNodesInteractionsHook()

    act(() => {
      result.current.handleCancelNodeSuccessStatus('n2')
    })

    await waitFor(() => {
      const n2 = result.current.nodes.find((node) => node.id === 'n2')
      expect(n2!.data._runningStatus).toBeUndefined()
      expect(n2!.data._waitingRun).toBe(false)
      expect(result.current.nodes.find((node) => node.id === 'n1')?.data).toMatchObject({
        _runningStatus: NodeRunningStatus.Running,
        _waitingRun: true,
      })
      expect(result.current.nodes.find((node) => node.id === 'n3')?.data).toMatchObject({
        _runningStatus: NodeRunningStatus.Failed,
        _waitingRun: true,
      })
    })
  })

  it('does not modify nodes that are not succeeded', async () => {
    const { result } = renderNodesInteractionsHook()

    act(() => {
      result.current.handleCancelNodeSuccessStatus('n1')
    })

    await waitFor(() => {
      const n1 = result.current.nodes.find((node) => node.id === 'n1')
      expect(n1!.data._runningStatus).toBe(NodeRunningStatus.Running)
      expect(n1!.data._waitingRun).toBe(true)
    })
  })
})
