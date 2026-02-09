import type { NodeFinishedResponse, NodeTracing } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  NodeRunningStatus,
} from '@/app/components/workflow/types'

export const useWorkflowNodeFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeFinished = useCallback((params: NodeFinishedResponse) => {
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
    } = store.getState()
    const nodes = getNodes()

    // Check if this is a fallback model
    const isFallbackModelException = data.status === NodeRunningStatus.Exception
      && data.execution_metadata?.error_strategy === ErrorHandleTypeEnum.fallbackModel

    // Check if existing record is from a fallback model flow (for node UI update)
    const existingTracingRecord = workflowRunningData?.tracing?.find(item => item.id === data.id)
    const isExistingFallbackFlow = existingTracingRecord?.execution_metadata?.error_strategy === ErrorHandleTypeEnum.fallbackModel

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const currentIndex = draft.tracing!.findIndex(item => item.id === data.id)
      if (currentIndex > -1) {
        const existingRecord = draft.tracing![currentIndex]

        // Check if existing record is from a fallback model flow
        const isExistingFallbackFlow = existingRecord.execution_metadata?.error_strategy === ErrorHandleTypeEnum.fallbackModel

        if (isExistingFallbackFlow && !isFallbackModelException) {
          // This is a subsequent event (success/failure) in a fallback flow
          // Add to fallbackDetail instead of overwriting the main record
          if (!existingRecord.fallbackDetail)
            existingRecord.fallbackDetail = []

          existingRecord.fallbackDetail.push(data as NodeTracing)

          // If fallback succeeded, update outputs but keep status as exception
          if (data.status === NodeRunningStatus.Succeeded) {
            existingRecord.outputs = data.outputs
            existingRecord.process_data = data.process_data
            existingRecord.elapsed_time = (existingRecord.elapsed_time || 0) + (data.elapsed_time || 0)
            // Update execution_metadata with successful model info if available
            if (data.execution_metadata) {
              existingRecord.execution_metadata = {
                ...existingRecord.execution_metadata,
                ...data.execution_metadata,
              }
            }
          }
          // Explicitly set status to exception (fallback flow always ends with exception status)
          existingRecord.status = NodeRunningStatus.Exception
        }
        else if (isFallbackModelException) {
          // First fallback exception - initialize fallbackDetail with this attempt
          const fallbackDetail = existingRecord.fallbackDetail || []
          fallbackDetail.push({
            ...data,
            retry_index: (data.execution_metadata?.fallback_model_index ?? 0),
          } as NodeTracing)

          draft.tracing![currentIndex] = {
            ...existingRecord,
            ...data,
            fallbackDetail,
          }
        }
        else {
          draft.tracing![currentIndex] = {
            ...existingRecord,
            ...data,
          }
        }
      }
    }))

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!

      if (isFallbackModelException) {
        // Fallback triggered - keep node in running state and show fallback index
        currentNode.data._fallbackIndex = (data.execution_metadata?.fallback_model_index ?? 0) + 1
      }
      else if (isExistingFallbackFlow && !isFallbackModelException) {
        // Fallback flow completed - set to exception status and clear fallback indicator
        currentNode.data._runningStatus = NodeRunningStatus.Exception
        currentNode.data._fallbackIndex = undefined
      }
      else {
        currentNode.data._runningStatus = data.status
        if (data.status === NodeRunningStatus.Exception) {
          if (data.execution_metadata?.error_strategy === ErrorHandleTypeEnum.failBranch)
            currentNode.data._runningBranchId = ErrorHandleTypeEnum.failBranch
        }
        else {
          if (data.node_type === BlockEnum.IfElse)
            currentNode.data._runningBranchId = data?.outputs?.selected_case_id

          if (data.node_type === BlockEnum.QuestionClassifier)
            currentNode.data._runningBranchId = data?.outputs?.class_id
        }
      }
    })
    setNodes(newNodes)

    // For fallback model exception, don't update edge status yet
    // For fallback flow completion, update edge with exception status
    if (!isFallbackModelException) {
      const edgeStatus = isExistingFallbackFlow ? NodeRunningStatus.Exception : data.status
      const newEdges = produce(edges, (draft) => {
        const incomeEdges = draft.filter((edge) => {
          return edge.target === data.node_id
        })
        incomeEdges.forEach((edge) => {
          edge.data = {
            ...edge.data,
            _targetRunningStatus: edgeStatus,
          }
        })
      })
      setEdges(newEdges)
    }
  }, [store, workflowStore])

  return {
    handleWorkflowNodeFinished,
  }
}
