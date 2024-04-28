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

export const useWorkflowInteractions = () => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const { handleNodeCancelRunningStatus } = useNodesInteractions()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractions()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleCancelDebugAndPreviewPanel = useCallback(() => {
    workflowStore.setState({
      showDebugAndPreviewPanel: false,
      workflowRunningData: undefined,
    })
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

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

  return {
    handleCancelDebugAndPreviewPanel,
    handleUpdateWorkflowCanvas,
  }
}
