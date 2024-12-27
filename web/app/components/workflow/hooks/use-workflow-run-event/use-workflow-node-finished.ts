import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { NodeFinishedResponse } from '@/types/workflow'
import {
  BlockEnum,
  NodeRunningStatus,
} from '@/app/components/workflow/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

export const useWorkflowNodeFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeFinished = useCallback((params: NodeFinishedResponse) => {
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
    } = store.getState()
    const nodes = getNodes()
    const nodeParentId = nodes.find(node => node.id === data.node_id)!.parentId
    if (nodeParentId) {
      if (!data.execution_metadata.parallel_mode_run_id) {
        setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
          const tracing = draft.tracing!
          const iterations = tracing.find(trace => trace.node_id === nodeParentId) // the iteration node

          if (iterations && iterations.details) {
            const iterationIndex = data.execution_metadata?.iteration_index || 0
            if (!iterations.details[iterationIndex])
              iterations.details[iterationIndex] = []

            const currIteration = iterations.details[iterationIndex]
            const nodeIndex = currIteration.findIndex(node =>
              node.node_id === data.node_id && (
                node.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || node.parallel_id === data.execution_metadata?.parallel_id),
            )
            if (nodeIndex !== -1) {
              currIteration[nodeIndex] = {
                ...currIteration[nodeIndex],
                ...(currIteration[nodeIndex].retryDetail
                  ? { retryDetail: currIteration[nodeIndex].retryDetail }
                  : {}),
                ...data,
              } as any
            }
            else {
              currIteration.push({
                ...data,
              } as any)
            }
          }
        }))
      }
      else {
        // open parallel mode
        setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
          const tracing = draft.tracing!
          const iterations = tracing.find(trace => trace.node_id === nodeParentId) // the iteration node

          if (iterations && iterations.details) {
            const iterRunID = data.execution_metadata?.parallel_mode_run_id

            const currIteration = iterParallelLogMap.get(iterations.node_id)?.get(iterRunID)
            const nodeIndex = currIteration?.findIndex(node =>
              node.node_id === data.node_id && (
                node?.parallel_run_id === data.execution_metadata?.parallel_mode_run_id),
            )
            if (currIteration) {
              if (nodeIndex !== undefined && nodeIndex !== -1) {
                currIteration[nodeIndex] = {
                  ...currIteration[nodeIndex],
                  ...data,
                } as any
              }
              else {
                currIteration.push({
                  ...data,
                } as any)
              }
            }
            setIterParallelLogMap(iterParallelLogMap)
            const iterLogMap = iterParallelLogMap.get(iterations.node_id)
            if (iterLogMap)
              iterations.details = Array.from(iterLogMap.values())
          }
        }))
      }
    }
    else {
      setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
        const currentIndex = draft.tracing!.findIndex((trace) => {
          if (!trace.execution_metadata?.parallel_id)
            return trace.node_id === data.node_id
          return trace.node_id === data.node_id && trace.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id
        })
        if (currentIndex > -1 && draft.tracing) {
          draft.tracing[currentIndex] = {
            ...data,
            ...(draft.tracing[currentIndex].extras
              ? { extras: draft.tracing[currentIndex].extras }
              : {}),
            ...(draft.tracing[currentIndex].retryDetail
              ? { retryDetail: draft.tracing[currentIndex].retryDetail }
              : {}),
          } as any
        }
      }))
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find(node => node.id === data.node_id)!
        currentNode.data._runningStatus = data.status as any
        if (data.status === NodeRunningStatus.Exception) {
          if (data.execution_metadata.error_strategy === ErrorHandleTypeEnum.failBranch)
            currentNode.data._runningBranchId = ErrorHandleTypeEnum.failBranch
        }
        else {
          if (data.node_type === BlockEnum.IfElse)
            currentNode.data._runningBranchId = data?.outputs?.selected_case_id

          if (data.node_type === BlockEnum.QuestionClassifier)
            currentNode.data._runningBranchId = data?.outputs?.class_id
        }
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        const incomeEdges = draft.filter((edge) => {
          return edge.target === data.node_id
        })
        incomeEdges.forEach((edge) => {
          edge.data = {
            ...edge.data,
            _targetRunningStatus: data.status as any,
          }
        })
      })
      setEdges(newEdges)
    }
  }, [workflowStore, store])

  return {
    handleWorkflowNodeFinished,
  }
}
