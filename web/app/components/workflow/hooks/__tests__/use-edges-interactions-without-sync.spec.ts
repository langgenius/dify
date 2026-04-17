import { act, waitFor } from '@testing-library/react'
import { useEdges } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../types'
import { useEdgesInteractionsWithoutSync } from '../use-edges-interactions-without-sync'

type EdgeRuntimeState = {
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

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

describe('useEdgesInteractionsWithoutSync', () => {
  it('clears running status and waitingRun on all edges', () => {
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

  it('does not mutate the original edges array', () => {
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
