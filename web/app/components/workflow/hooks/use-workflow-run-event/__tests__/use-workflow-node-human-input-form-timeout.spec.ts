import type { HumanInputFormTimeoutResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowNodeHumanInputFormTimeout } from '../use-workflow-node-human-input-form-timeout'

describe('useWorkflowNodeHumanInputFormTimeout', () => {
  it('sets expiration_time on the matching form', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormTimeout(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '', expiration_time: 0 },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputFormTimeout({
      data: { node_id: 'n1', node_title: 'Node 1', expiration_time: 1000 },
    } as HumanInputFormTimeoutResponse)

    expect(store.getState().workflowRunningData!.humanInputFormDataList![0]!.expiration_time).toBe(1000)
  })
})
