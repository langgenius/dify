import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeLoopNext } from '../use-workflow-node-loop-next'
import {
  createLoopNextResponse,
  getNodeRuntimeState,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowNodeLoopNext', () => {
  it('sets _loopIndex and resets child nodes to waiting', async () => {
    const { result } = renderRunEventHook(() => useWorkflowNodeLoopNext(), {
      nodes: [
        createNode({ id: 'n1', data: {} }),
        createNode({
          id: 'n2',
          position: { x: 300, y: 0 },
          parentId: 'n1',
          data: { _waitingRun: false },
        }),
      ],
      edges: [],
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeLoopNext(createLoopNextResponse())
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n1'))._loopIndex).toBe(5)
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n2'))._waitingRun).toBe(true)
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n2'))._runningStatus).toBe(NodeRunningStatus.Waiting)
    })
  })
})
