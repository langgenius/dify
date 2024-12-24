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
      iterParallelLogMap,
      setIterParallelLogMap,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
      transform,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === data.node_id)
    if (node?.parentId) {
      setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
        const tracing = draft.tracing!
        const iterations = tracing.find(trace => trace.node_id === node?.parentId)
        const currIteration = iterations?.details![node.data.iteration_index] || iterations?.details![iterations.details!.length - 1]
        if (!data.parallel_run_id) {
          currIteration?.push({
            ...data,
            status: NodeRunningStatus.Running,
          } as any)
        }
        else {
          const nodeId = iterations?.node_id as string
          if (!iterParallelLogMap.has(nodeId as string))
            iterParallelLogMap.set(iterations?.node_id as string, new Map())

          const currentIterLogMap = iterParallelLogMap.get(nodeId)!
          if (!currentIterLogMap.has(data.parallel_run_id))
            currentIterLogMap.set(data.parallel_run_id, [{ ...data, status: NodeRunningStatus.Running } as any])
          else
            currentIterLogMap.get(data.parallel_run_id)!.push({ ...data, status: NodeRunningStatus.Running } as any)
          setIterParallelLogMap(iterParallelLogMap)
          if (iterations)
            iterations.details = Array.from(currentIterLogMap.values())
        }
      }))
    }
    else {
      setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
        draft.tracing!.push({
          ...data,
          status: NodeRunningStatus.Running,
        } as any)
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
    }
  }, [workflowStore, store, reactflow])

  return {
    handleWorkflowNodeStarted,
  }
}
