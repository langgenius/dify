import type { HumanInputRequiredResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'
// import { WorkflowRunningStatus } from '@/app/components/workflow/types'

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
      draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Paused
      // draft[currentNodeIndex].data._waitingRun = false
      // store form data & input form schema
    })
    setNodes(newNodes)

    // cache form data & generate input form UI in node data
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        // status: WorkflowRunningStatus.Paused, // human input required !== workflow  'Paused'
      }
    }))
  }, [store, workflowStore])

  return {
    handleWorkflowNodeHumanInputRequired,
  }
}
