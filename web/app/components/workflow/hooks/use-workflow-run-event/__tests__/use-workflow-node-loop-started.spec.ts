import type { LoopStartedResponse } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeLoopStarted } from '../use-workflow-node-loop-started'
import {
  containerParams,
  createViewportNodes,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  renderViewportHook,
} from './test-helpers'

describe('useWorkflowNodeLoopStarted', () => {
  it('pushes to tracing, sets viewport, and updates node with _loopLength', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeLoopStarted(), {
      nodes: createViewportNodes().slice(0, 2),
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeLoopStarted(
        { data: { node_id: 'n1', metadata: { loop_length: 5 } } } as LoopStartedResponse,
        containerParams,
      )
    })

    expect(store.getState().workflowRunningData!.tracing![0]!.status).toBe(NodeRunningStatus.Running)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._loopLength).toBe(5)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })
})
