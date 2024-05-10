import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { useWorkflowStore } from '../store'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import type { WorkflowDataUpdator } from '../types'
import {
  initialEdges,
  initialNodes,
} from '../utils'
import { useEdgesInteractions } from './use-edges-interactions'
import { useNodesInteractions } from './use-nodes-interactions'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { fetchWorkflowDraft } from '@/service/workflow'

export const useWorkflowInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { handleNodeCancelRunningStatus } = useNodesInteractions()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractions()

  const handleCancelDebugAndPreviewPanel = useCallback(() => {
    workflowStore.setState({
      showDebugAndPreviewPanel: false,
      workflowRunningData: undefined,
    })
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

  return {
    handleCancelDebugAndPreviewPanel,
  }
}

export const useWorkflowUpdate = () => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleUpdateWorkflowCanvas = useCallback((payload: WorkflowDataUpdator) => {
    const {
      nodes,
      edges,
      viewport,
    } = payload
    const { setViewport } = reactflow
    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
      },
    } as any)
    setViewport(viewport)
  }, [eventEmitter, reactflow])

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      appId,
      setSyncWorkflowDraftHash,
    } = workflowStore.getState()
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`).then((response) => {
      handleUpdateWorkflowCanvas(response.graph as WorkflowDataUpdator)
      setSyncWorkflowDraftHash(response.hash)
    })
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleUpdateWorkflowCanvas,
    handleRefreshWorkflowDraft,
  }
}
