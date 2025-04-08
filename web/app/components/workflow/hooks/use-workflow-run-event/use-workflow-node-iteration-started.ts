import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { IterationStartedResponse } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { DEFAULT_ITER_TIMES } from '@/app/components/workflow/constants'

export const useWorkflowNodeIterationStarted = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationStarted = useCallback((
    params: IterationStartedResponse,
    containerParams: {
      clientWidth: number,
      clientHeight: number,
    },
  ) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
      setIterTimes,
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
    setIterTimes(DEFAULT_ITER_TIMES)

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
      draft[currentNodeIndex].data._iterationLength = data.metadata.iterator_length
      draft[currentNodeIndex].data._waitingRun = false
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const incomeEdges = draft.filter(edge => edge.target === data.node_id)

      incomeEdges.forEach((edge) => {
        edge.data = {
          ...edge.data,
          _sourceRunningStatus: nodes.find(node => node.id === edge.source)!.data._runningStatus,
          _targetRunningStatus: NodeRunningStatus.Running,
          _waitingRun: false,
        }
      })
    })
    setEdges(newEdges)
  }, [workflowStore, store, reactflow])

  return {
    handleWorkflowNodeIterationStarted,
  }
}
