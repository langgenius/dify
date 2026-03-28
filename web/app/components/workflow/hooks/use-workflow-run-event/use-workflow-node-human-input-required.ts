import type { HumanInputRequiredResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowNodeHumanInputRequired = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  // Notice: Human input required !== Workflow Paused
  const handleWorkflowNodeHumanInputRequired = useCallback((params: HumanInputRequiredResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    const newWorkflowRunningData = produce(workflowRunningData!, (draft) => {
      if (!draft.humanInputFormDataList) {
        draft.humanInputFormDataList = [data]
      }
      else {
        const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        if (currentFormIndex > -1) {
          draft.humanInputFormDataList[currentFormIndex] = data
        }
        else {
          draft.humanInputFormDataList.push(data)
        }
      }
      const currentIndex = draft.tracing!.findIndex(item => item.node_id === data.node_id)
      if (currentIndex > -1) {
        draft.tracing![currentIndex] = {
          ...draft.tracing![currentIndex],
          status: NodeRunningStatus.Paused,
        }
      }
    })
    setWorkflowRunningData(newWorkflowRunningData)

    const {
      getNodes,
      setNodes,
    } = store.getState()
    const nodes = getNodes()
    const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
    const newNodes = produce(nodes, (draft) => {
      draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Paused
    })
    setNodes(newNodes)
  }, [store, workflowStore])

  return {
    handleWorkflowNodeHumanInputRequired,
  }
}
