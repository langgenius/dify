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
})
