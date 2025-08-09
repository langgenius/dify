import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type {
  NodeFinishedResponse,
} from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeRetry = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeRetry = useCallback((params: NodeFinishedResponse) => {
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
    // Get the title from the graph node instead of using the title from the event
    const graphNode = nodes.find(node => node.id === data.node_id)
    const nodeTitle = graphNode?.data?.title || data.title

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.tracing!.push({
        ...data,
        title: nodeTitle, // Use the title from the graph node
      })
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
