import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { LoopFinishedResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { DEFAULT_LOOP_TIMES } from '@/app/components/workflow/constants'

export const useWorkflowNodeLoopFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeLoopFinished = useCallback((params: LoopFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
      setLoopTimes,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const nodes = getNodes()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const currentIndex = draft.tracing!.findIndex(item => item.id === data.id)

      if (currentIndex > -1) {
        draft.tracing![currentIndex] = {
          ...draft.tracing![currentIndex],
          ...data,
        }
      }
    }))
    setLoopTimes(DEFAULT_LOOP_TIMES)
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!

      currentNode.data._runningStatus = data.status
    })
    setNodes(newNodes)
  }, [workflowStore, store])

  return {
    handleWorkflowNodeLoopFinished,
  }
}
