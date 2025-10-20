import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { produce } from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { LoopStartedResponse } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowNodeLoopStarted = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeLoopStarted = useCallback((
    params: LoopStartedResponse,
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
      draft[currentNodeIndex].data._loopLength = data.metadata.loop_length
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
    handleWorkflowNodeLoopStarted,
  }
}
