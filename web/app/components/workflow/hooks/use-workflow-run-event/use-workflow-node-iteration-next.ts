import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { IterationNextResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeIterationNext = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationNext = useCallback((params: IterationNextResponse) => {
    const {
      workflowRunningData,
      setWorkflowRunningData,
      iterTimes,
      setIterTimes,
    } = workflowStore.getState()

    const { data } = params
    const {
      getNodes,
      setNodes,
    } = store.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const iteration = draft.tracing!.find(trace => trace.node_id === data.node_id)
      if (iteration) {
        if (iteration.iterDurationMap && data.duration)
          iteration.iterDurationMap[data.parallel_mode_run_id ?? `${data.index - 1}`] = data.duration
        if (iteration.details!.length >= iteration.metadata.iterator_length!)
          return
      }
      if (!data.parallel_mode_run_id)
        iteration?.details!.push([])
    }))
    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!
      currentNode.data._iterationIndex = iterTimes
      setIterTimes(iterTimes + 1)
    })
    setNodes(newNodes)
  }, [])

  return {
    handleWorkflowNodeIterationNext,
  }
}