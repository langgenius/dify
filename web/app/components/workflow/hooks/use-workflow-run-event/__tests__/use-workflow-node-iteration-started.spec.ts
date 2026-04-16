import type { IterationStartedResponse } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../../constants'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeIterationStarted } from '../use-workflow-node-iteration-started'
import {
  containerParams,
  createViewportNodes,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  renderViewportHook,
} from './test-helpers'

describe('useWorkflowNodeIterationStarted', () => {
  it('pushes to tracing, resets iterTimes, sets viewport, and updates node with _iterationLength', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeIterationStarted(), {
      nodes: createViewportNodes().slice(0, 2),
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 99,
      },
    })

    act(() => {
      result.current.handleWorkflowNodeIterationStarted(
        { data: { node_id: 'n1', metadata: { iterator_length: 10 } } } as IterationStartedResponse,
        containerParams,
      )
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing[0]!.status).toBe(NodeRunningStatus.Running)
    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._iterationLength).toBe(10)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })
})
