import type { WorkflowFinishedResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowFinished } from '../use-workflow-finished'

describe('useWorkflowFinished', () => {
  it('merges data into result and activates result tab for single string output', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { answer: 'hello' } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.result.status).toBe('succeeded')
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('hello')
  })

  it('does not activate the result tab for multi-key outputs', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { a: 'hello', b: 'world' } },
    } as WorkflowFinishedResponse)

    expect(store.getState().workflowRunningData!.resultTabActive).toBeFalsy()
  })
})
