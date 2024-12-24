import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { 
  NodeFinishedResponse,
  NodeTracing,
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
      iterParallelLogMap,
      setIterParallelLogMap,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === data.node_id)!
    const nodeParent = nodes.find(node => node.id === currentNode.parentId)
    if (nodeParent) {
      if (!data.execution_metadata.parallel_mode_run_id) {
        setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
          const tracing = draft.tracing!
          const iteration = tracing.find(trace => trace.node_id === nodeParent.id)

          if (iteration && iteration.details?.length) {
            const currentNodeRetry = iteration.details[nodeParent.data._iterationIndex - 1]?.find(item => item.node_id === data.node_id)

            if (currentNodeRetry) {
              if (currentNodeRetry?.retryDetail)
                currentNodeRetry?.retryDetail.push(data as NodeTracing)
              else
                currentNodeRetry.retryDetail = [data as NodeTracing]
            }
          }
        }))
      }
      else {
        setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
          const tracing = draft.tracing!
          const iteration = tracing.find(trace => trace.node_id === nodeParent.id)

          if (iteration && iteration.details?.length) {
            const iterRunID = data.execution_metadata?.parallel_mode_run_id

            const currIteration = iterParallelLogMap.get(iteration.node_id)?.get(iterRunID)
            const currentNodeRetry = currIteration?.find(item => item.node_id === data.node_id)

            if (currentNodeRetry) {
              if (currentNodeRetry?.retryDetail)
                currentNodeRetry?.retryDetail.push(data as NodeTracing)
              else
                currentNodeRetry.retryDetail = [data as NodeTracing]
            }
            setIterParallelLogMap(iterParallelLogMap)
            const iterLogMap = iterParallelLogMap.get(iteration.node_id)
            if (iterLogMap)
              iteration.details = Array.from(iterLogMap.values())
          }
        }))
      }
    }
    else {
      setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
        const tracing = draft.tracing!
        const currentRetryNodeIndex = tracing.findIndex(trace => trace.node_id === data.node_id)

        if (currentRetryNodeIndex > -1) {
          const currentRetryNode = tracing[currentRetryNodeIndex]
          if (currentRetryNode.retryDetail)
            draft.tracing![currentRetryNodeIndex].retryDetail!.push(data as NodeTracing)
          else
            draft.tracing![currentRetryNodeIndex].retryDetail = [data as NodeTracing]
        }
      }))
    }
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!

      currentNode.data._retryIndex = data.retry_index
    })
    setNodes(newNodes)
  }, [])

  return {
    handleWorkflowNodeRetry,
  }
}