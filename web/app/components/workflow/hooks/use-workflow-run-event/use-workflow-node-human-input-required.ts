import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { produce } from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { HumanInputRequiredResponse } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowNodeHumanInputRequired = () => {
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()

  const handleWorkflowNodeHumanInputRequired = useCallback((params: HumanInputRequiredResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const nodes = getNodes()
    const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
    const newNodes = produce(nodes, (draft) => {
      draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Suspended
      // draft[currentNodeIndex].data._waitingRun = false
    })
    setNodes(newNodes)

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        status: WorkflowRunningStatus.Suspended,
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowNodeHumanInputRequired,
  }
}
