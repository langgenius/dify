import type { NodeFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

export const useWorkflowNodeRetry = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeRetry = useCallback(
    (params: NodeFinishedResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
      const { getNodes } = store.getState()

      const nodes = getNodes()
      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.tracing!.push(data)
        }),
      )
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === data.node_id)!

        currentNode.data._retryIndex = data.retry_index
      })
      collaborativeWorkflow.setNodes(newNodes, false)
    },
    [collaborativeWorkflow, workflowStore, store],
  )

  return {
    handleWorkflowNodeRetry,
  }
}
