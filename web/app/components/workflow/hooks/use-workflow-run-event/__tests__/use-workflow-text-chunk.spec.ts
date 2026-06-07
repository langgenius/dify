import type { TextChunkResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowTextChunk } from '../use-workflow-text-chunk'

describe('useWorkflowTextChunk', () => {
  it('appends text and activates the result tab', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'Hello' }),
      },
    })

    result.current.handleWorkflowTextChunk({ data: { text: ' World' } } as TextChunkResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultText).toBe('Hello World')
    expect(state.resultTabActive).toBe(true)
  })

  it('inserts a line break when text chunks switch to a different output selector', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'Hello', resultTextSelectorKey: 'end.answer' }),
      },
    })

    result.current.handleWorkflowTextChunk({
      data: { text: '42', from_variable_selector: ['end', 'count'] },
    } as TextChunkResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultText).toBe('Hello\n42')
    expect(state.resultTextSelectorKey).toBe('end.count')
  })

  it('does not add an extra line break when the incoming chunk already starts with one', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'Hello', resultTextSelectorKey: 'end.answer' }),
      },
    })

    result.current.handleWorkflowTextChunk({
      data: { text: '\n42', from_variable_selector: ['end', 'count'] },
    } as TextChunkResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultText).toBe('Hello\n42')
    expect(state.resultTextSelectorKey).toBe('end.count')
  })

  it('does not insert a line break when text chunks stay on the same output selector', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'Hello', resultTextSelectorKey: 'end.answer' }),
      },
    })

    result.current.handleWorkflowTextChunk({
      data: { text: ' world', from_variable_selector: ['end', 'answer'] },
    } as TextChunkResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultText).toBe('Hello world')
    expect(state.resultTextSelectorKey).toBe('end.answer')
  })
})
