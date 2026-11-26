import type { IterationFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { DEFAULT_ITER_TIMES } from '@/app/components/workflow/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

export const useWorkflowNodeIterationFinished = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationFinished = useCallback(
    (params: IterationFinishedResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData, setIterTimes } = workflowStore.getState()
      const { getNodes, edges } = store.getState()
      const nodes = getNodes()
      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          const currentIndex = draft.tracing!.findIndex((item) => item.id === data.id)

          if (currentIndex > -1) {
            draft.tracing![currentIndex] = {
              ...draft.tracing![currentIndex],
              ...data,
            }
          }
        }),
      )
      setIterTimes(DEFAULT_ITER_TIMES)
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === data.node_id)!

        currentNode.data._runningStatus = data.status
      })
      collaborativeWorkflow.setNodes(newNodes, false)
      const newEdges = produce(edges, (draft) => {
        const incomeEdges = draft.filter((edge) => {
          return edge.target === data.node_id
        })
        incomeEdges.forEach((edge) => {
          edge.data = {
            ...edge.data,
            _targetRunningStatus: data.status,
          }
        })
      })
      collaborativeWorkflow.setEdges(newEdges, false)
    },
    [collaborativeWorkflow, workflowStore, store],
  )

  return {
    handleWorkflowNodeIterationFinished,
  }
}
