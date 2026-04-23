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
    expect(state.resultText).toBe('hello\nworld')
  })

  it('formats object outputs with indentation and separates them with line breaks', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: {
        status: 'succeeded',
        outputs: {
          first: '9b01d2cd-300c-487d-9f85-14dd5fdeefd0',
          second: { a: 'b' },
          third: 'da87037a-33bd-41d7-9dc6-4052a2e86a17',
        },
      },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('9b01d2cd-300c-487d-9f85-14dd5fdeefd0\n{\n  "a": "b"\n}\nda87037a-33bd-41d7-9dc6-4052a2e86a17')
  })

  it('shows scalar outputs like numbers and booleans in the result tab', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { count: 42, ok: false } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('42\nfalse')
  })

  it('keeps an empty string output instead of treating it as missing', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { answer: '' } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('')
  })

  it('skips null outputs instead of rendering "null"', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { ignored: null, answer: 'hello' } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('hello')
  })
})
