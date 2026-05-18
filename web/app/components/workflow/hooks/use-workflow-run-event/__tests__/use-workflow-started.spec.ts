import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../../types'
import { useWorkflowStarted } from '../use-workflow-started'
import {
  createStartedResponse,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  pausedRunningData,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowStarted', () => {
  it('initializes workflow running data and resets nodes and edges', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowStarted(createStartedResponse())
    })

    const state = store.getState().workflowRunningData!
    expect(state.task_id).toBe('task-2')
    expect(state.result.status).toBe(WorkflowRunningStatus.Running)
    expect(state.resultText).toBe('')

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._waitingRun).toBe(true)
      expect(getNodeRuntimeState(result.current.nodes[0])._runningBranchId).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._sourceRunningStatus).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._waitingRun).toBe(true)
    })
  })

  it('resumes from Paused without resetting nodes or edges', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: pausedRunningData(),
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowStarted(createStartedResponse({
        data: { id: 'run-2', workflow_id: 'wf-1', created_at: 2000 },
      }))
    })

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Running)
    expect(getNodeRuntimeState(result.current.nodes[0])._waitingRun).toBe(false)
    expect(getEdgeRuntimeState(result.current.edges[0])._waitingRun).toBeUndefined()
  })
})
