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

  it('joins multi-key text outputs with blank lines and activates the result tab', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { a: 'hello', b: 'world' } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('hello\n\nworld')
  })

  it('keeps non-text multi-key outputs in detail view', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { a: { foo: 'bar' }, b: 1 } },
    } as WorkflowFinishedResponse)

    expect(store.getState().workflowRunningData!.resultTabActive).toBeFalsy()
  })
})
