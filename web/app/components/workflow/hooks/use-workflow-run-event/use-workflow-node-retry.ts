import type {
  NodeFinishedResponse,
} from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeRetry = () => {
  const store = useWorkflowStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeRetry = useCallback((params: NodeFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const {
      nodes,
      setNodes,
    } = store.getState()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.tracing!.push(data)
    }))
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!

      currentNode.data._retryIndex = data.retry_index
    })
    setNodes(newNodes)
  }, [workflowStore, store])

  return {
    handleWorkflowNodeRetry,
  }
}
