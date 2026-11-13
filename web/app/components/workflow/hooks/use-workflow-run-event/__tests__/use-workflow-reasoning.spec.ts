import type { ReasoningChunkResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowReasoning } from '../use-workflow-reasoning'

const reasoningChunk = (data: Partial<ReasoningChunkResponse['data']>): ReasoningChunkResponse => ({
  task_id: 'task-1',
  event: 'reasoning_chunk',
  data: { message_id: '', reasoning: '', ...data },
})

describe('useWorkflowReasoning', () => {
  it('accumulates interleaved reasoning deltas independently for each LLM node', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowReasoning(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: '' }),
      },
    })

    result.current.handleWorkflowReasoning(reasoningChunk({ reasoning: 'let me ', node_id: 'llm' }))
    result.current.handleWorkflowReasoning(reasoningChunk({ reasoning: 'other', node_id: 'llm-2' }))
    result.current.handleWorkflowReasoning(reasoningChunk({ reasoning: 'think', node_id: 'llm' }))

    const state = store.getState().workflowRunningData!
    expect(state.reasoningContent).toEqual({ llm: 'let me think', 'llm-2': 'other' })
    expect(state.reasoningFinished).toBeFalsy()
  })

  it('falls back to "_" when the chunk carries no node id', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowReasoning(), {
      initialStoreState: { workflowRunningData: baseRunningData({ resultText: '' }) },
    })

    result.current.handleWorkflowReasoning(reasoningChunk({ reasoning: 'x' }))

    expect(store.getState().workflowRunningData!.reasoningContent).toEqual({ _: 'x' })
  })

  it('marks reasoning finished on the terminal marker without appending empty text', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowReasoning(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: '', reasoningContent: { llm: 'done' } }),
      },
    })

    result.current.handleWorkflowReasoning(
      reasoningChunk({ reasoning: '', node_id: 'llm', is_final: true }),
    )

    const state = store.getState().workflowRunningData!
    expect(state.reasoningContent).toEqual({ llm: 'done' })
    expect(state.reasoningFinished).toBe(true)
  })
})
