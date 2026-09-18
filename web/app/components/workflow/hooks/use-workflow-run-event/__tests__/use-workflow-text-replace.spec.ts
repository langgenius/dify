import type { TextReplaceResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowTextReplace } from '../use-workflow-text-replace'

describe('useWorkflowTextReplace', () => {
  it('replaces resultText', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextReplace(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'old text' }),
      },
    })

    result.current.handleWorkflowTextReplace({ data: { text: 'new text' } } as TextReplaceResponse)

    expect(store.getState().workflowRunningData!.resultText).toBe('new text')
  })
})
