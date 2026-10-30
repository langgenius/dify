import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowTextReplace } from '../use-workflow-text-replace'

describe('useWorkflowTextReplace', () => {
  it('replaces resultText', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextReplace(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'old text' }),
      },
    })

    result.current.handleWorkflowTextReplace({
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      event: 'text_replace',
      data: { text: 'new text' },
    })

    expect(store.getState().workflowRunningData!.resultText).toBe('new text')
  })
})
