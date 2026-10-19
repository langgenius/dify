import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowNodeHumanInputFormFilled } from '../use-workflow-node-human-input-form-filled'

describe('useWorkflowNodeHumanInputFormFilled', () => {
  it('removes the form from pending and adds it to filled', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormFilled(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    const data = {
      node_id: 'n1',
      node_title: 'Node 1',
      rendered_content: 'done',
      action_id: 'approve',
      action_text: 'Approve',
    }
    result.current.handleWorkflowNodeHumanInputFormFilled({
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      event: 'human_input_form_filled',
      data,
    })

    const state = store.getState().workflowRunningData!
    expect(state.humanInputFormDataList).toHaveLength(0)
    expect(state.humanInputFilledFormDataList).toEqual([data])
  })
})
