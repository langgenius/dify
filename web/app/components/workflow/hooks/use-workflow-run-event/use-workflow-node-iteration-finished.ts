import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { IterationFinishedResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { DEFAULT_ITER_TIMES } from '@/app/components/workflow/constants'

export const useWorkflowNodeIterationFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationFinished = useCallback((params: IterationFinishedResponse) => {
    const { data } = params
    
    const {
      workflowRunningData,
      setWorkflowRunningData,
      setIterTimes,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const nodes = getNodes()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const tracing = draft.tracing!
      const currIterationNode = tracing.find(trace => trace.node_id === data.node_id)
      if (currIterationNode) {
        Object.assign(currIterationNode, {
          ...data,
          status: NodeRunningStatus.Succeeded,
        })
      }
    }))
    setIterTimes(DEFAULT_ITER_TIMES)
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!

      currentNode.data._runningStatus = data.status
    })
    setNodes(newNodes)
  }, [])

  return {
    handleWorkflowNodeIterationFinished,
  }
}