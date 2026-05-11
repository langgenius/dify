import type { HumanInputFormFilledResponse } from '@/types/workflow'
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

    result.current.handleWorkflowNodeHumanInputFormFilled({
      data: { node_id: 'n1', node_title: 'Node 1', rendered_content: 'done' },
    } as HumanInputFormFilledResponse)

    const state = store.getState().workflowRunningData!
    expect(state.humanInputFormDataList).toHaveLength(0)
    expect(state.humanInputFilledFormDataList).toHaveLength(1)
    expect(state.humanInputFilledFormDataList![0]!.node_id).toBe('n1')
  })

  it('creates humanInputFilledFormDataList when it does not exist', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormFilled(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputFormFilled({
      data: { node_id: 'n1', node_title: 'Node 1', rendered_content: 'done' },
    } as HumanInputFormFilledResponse)

    expect(store.getState().workflowRunningData!.humanInputFilledFormDataList).toBeDefined()
  })
})
