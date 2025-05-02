import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import type { NodeStartedResponse } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeStarted = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()

  const handleWorkflowNodeStarted = useCallback((
    params: NodeStartedResponse,
    containerParams: {
      clientWidth: number,
      clientHeight: number,
    },
  ) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
      transform,
    } = store.getState()
    const nodes = getNodes()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.tracing!.push({
        ...data,
        status: NodeRunningStatus.Running,
      })
    }))

    const {
      setViewport,
    } = reactflow
    const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
    const currentNode = nodes[currentNodeIndex]
    const position = currentNode.position
    const zoom = transform[2]

    if (!currentNode.parentId) {
      setViewport({
        x: (containerParams.clientWidth - 400 - currentNode.width! * zoom) / 2 - position.x * zoom,
        y: (containerParams.clientHeight - currentNode.height! * zoom) / 2 - position.y * zoom,
        zoom: transform[2],
      })
    }
    const newNodes = produce(nodes, (draft) => {
      draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Running
      draft[currentNodeIndex].data._waitingRun = false
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const incomeEdges = draft.filter((edge) => {
        return edge.target === data.node_id
      })

      incomeEdges.forEach((edge) => {
        const incomeNode = nodes.find(node => node.id === edge.source)!
        if (
          (!incomeNode.data._runningBranchId && edge.sourceHandle === 'source')
          || (incomeNode.data._runningBranchId && edge.sourceHandle === incomeNode.data._runningBranchId)
        ) {
          edge.data = {
            ...edge.data,
            _sourceRunningStatus: incomeNode.data._runningStatus,
            _targetRunningStatus: NodeRunningStatus.Running,
            _waitingRun: false,
          }
        }
      })
    })
    setEdges(newEdges)
  }, [workflowStore, store, reactflow])

  return {
    handleWorkflowNodeStarted,
  }
}
