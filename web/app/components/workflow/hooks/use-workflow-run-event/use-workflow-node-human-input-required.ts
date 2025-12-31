import type { HumanInputRequiredResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowNodeHumanInputRequired = () => {
  const store = useStoreApi()

  // ! Human input required !== Workflow Paused
  const handleWorkflowNodeHumanInputRequired = useCallback((params: HumanInputRequiredResponse) => {
    const { data } = params

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
  }, [store])

  return {
    handleWorkflowNodeHumanInputRequired,
  }
}
