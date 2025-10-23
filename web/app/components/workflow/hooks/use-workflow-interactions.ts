import {
  useCallback,
} from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { produce } from 'immer'
import { useStore, useWorkflowStore } from '../store'
import {
  CUSTOM_NODE,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_VERTICAL_PADDING,
  WORKFLOW_DATA_UPDATE,
} from '../constants'
import type { WorkflowDataUpdater } from '../types'
import { BlockEnum, ControlMode } from '../types'
import {
  getLayoutByDagre,
  getLayoutForChildNodes,
  initialEdges,
  initialNodes,
} from '../utils'
import type { LayoutResult } from '../utils'
import {
  useNodesReadOnly,
  useSelectionInteractions,
  useWorkflowReadOnly,
} from '../hooks'
import { useEdgesInteractionsWithoutSync } from './use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { WorkflowHistoryEvent, useWorkflowHistory } from './use-workflow-history'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export const useWorkflowInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { handleNodeCancelRunningStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()

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

export const useWorkflowMoveMode = () => {
  const setControlMode = useStore(s => s.setControlMode)
  const {
    getNodesReadOnly,
  } = useNodesReadOnly()
  const { handleSelectionCancel } = useSelectionInteractions()

  const handleModePointer = useCallback(() => {
    if (getNodesReadOnly())
      return

    setControlMode(ControlMode.Pointer)
  }, [getNodesReadOnly, setControlMode])

  const handleModeHand = useCallback(() => {
    if (getNodesReadOnly())
      return

    setControlMode(ControlMode.Hand)
    handleSelectionCancel()
  }, [getNodesReadOnly, setControlMode, handleSelectionCancel])

  return {
    handleModePointer,
    handleModeHand,
  }
}

export const useWorkflowOrganize = () => {
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleLayout = useCallback(async () => {
    if (getNodesReadOnly())
      return
    workflowStore.setState({ nodeAnimation: true })
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()
    const { setViewport } = reactflow
    const nodes = getNodes()

    const loopAndIterationNodes = nodes.filter(
      node => (node.data.type === BlockEnum.Loop || node.data.type === BlockEnum.Iteration)
              && !node.parentId
              && node.type === CUSTOM_NODE,
    )

    const childLayoutEntries = await Promise.all(
      loopAndIterationNodes.map(async node => [
        node.id,
        await getLayoutForChildNodes(node.id, nodes, edges),
      ] as const),
    )
    const childLayoutsMap = childLayoutEntries.reduce((acc, [nodeId, layout]) => {
      if (layout)
        acc[nodeId] = layout
      return acc
    }, {} as Record<string, LayoutResult>)

    const containerSizeChanges: Record<string, { width: number, height: number }> = {}

    loopAndIterationNodes.forEach((parentNode) => {
      const childLayout = childLayoutsMap[parentNode.id]
      if (!childLayout) return

      const {
        bounds,
        nodes: layoutNodes,
      } = childLayout

      if (!layoutNodes.size)
        return

      const requiredWidth = (bounds.maxX - bounds.minX) + NODE_LAYOUT_HORIZONTAL_PADDING * 2
      const requiredHeight = (bounds.maxY - bounds.minY) + NODE_LAYOUT_VERTICAL_PADDING * 2

      containerSizeChanges[parentNode.id] = {
        width: Math.max(parentNode.width || 0, requiredWidth),
        height: Math.max(parentNode.height || 0, requiredHeight),
      }
    })

    const nodesWithUpdatedSizes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if ((node.data.type === BlockEnum.Loop || node.data.type === BlockEnum.Iteration)
            && containerSizeChanges[node.id]) {
          node.width = containerSizeChanges[node.id].width
          node.height = containerSizeChanges[node.id].height

          if (node.data.type === BlockEnum.Loop) {
            node.data.width = containerSizeChanges[node.id].width
            node.data.height = containerSizeChanges[node.id].height
          }
          else if (node.data.type === BlockEnum.Iteration) {
            node.data.width = containerSizeChanges[node.id].width
            node.data.height = containerSizeChanges[node.id].height
          }
        }
      })
    })

    const layout = await getLayoutByDagre(nodesWithUpdatedSizes, edges)

    // Build layer map for vertical alignment - nodes in the same layer should align
    const layerMap = new Map<number, { minY: number; maxHeight: number }>()
    layout.nodes.forEach((layoutInfo) => {
      if (layoutInfo.layer !== undefined) {
        const existing = layerMap.get(layoutInfo.layer)
        const newLayerInfo = {
          minY: existing ? Math.min(existing.minY, layoutInfo.y) : layoutInfo.y,
          maxHeight: existing ? Math.max(existing.maxHeight, layoutInfo.height) : layoutInfo.height,
        }
        layerMap.set(layoutInfo.layer, newLayerInfo)
      }
    })

    const newNodes = produce(nodesWithUpdatedSizes, (draft) => {
      draft.forEach((node) => {
        if (!node.parentId && node.type === CUSTOM_NODE) {
          const layoutInfo = layout.nodes.get(node.id)
          if (!layoutInfo)
            return

          // Calculate vertical position with layer alignment
          let yPosition = layoutInfo.y
          if (layoutInfo.layer !== undefined) {
            const layerInfo = layerMap.get(layoutInfo.layer)
            if (layerInfo) {
              // Align to the center of the tallest node in this layer
              const layerCenterY = layerInfo.minY + layerInfo.maxHeight / 2
              yPosition = layerCenterY - layoutInfo.height / 2
            }
          }

          node.position = {
            x: layoutInfo.x,
            y: yPosition,
          }
        }
      })

      loopAndIterationNodes.forEach((parentNode) => {
        const childLayout = childLayoutsMap[parentNode.id]
        if (!childLayout)
          return

        const childNodes = draft.filter(node => node.parentId === parentNode.id)
        const {
          bounds,
          nodes: layoutNodes,
        } = childLayout

        childNodes.forEach((childNode) => {
          const layoutInfo = layoutNodes.get(childNode.id)
          if (!layoutInfo)
            return

          childNode.position = {
            x: NODE_LAYOUT_HORIZONTAL_PADDING + (layoutInfo.x - bounds.minX),
            y: NODE_LAYOUT_VERTICAL_PADDING + (layoutInfo.y - bounds.minY),
          }
        })
      })
    })

    setNodes(newNodes)
    const zoom = 0.7
    setViewport({
      x: 0,
      y: 0,
      zoom,
    })
    saveStateToHistory(WorkflowHistoryEvent.LayoutOrganize)
    setTimeout(() => {
      handleSyncWorkflowDraft()
    })
  }, [getNodesReadOnly, store, reactflow, workflowStore, handleSyncWorkflowDraft, saveStateToHistory])

  return {
    handleLayout,
  }
}

export const useWorkflowZoom = () => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getWorkflowReadOnly } = useWorkflowReadOnly()
  const {
    zoomIn,
    zoomOut,
    zoomTo,
    fitView,
  } = useReactFlow()

  const handleFitView = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    fitView()
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, fitView, handleSyncWorkflowDraft])

  const handleBackToOriginalSize = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    zoomTo(1)
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, zoomTo, handleSyncWorkflowDraft])

  const handleSizeToHalf = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    zoomTo(0.5)
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, zoomTo, handleSyncWorkflowDraft])

  const handleZoomOut = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    zoomOut()
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, zoomOut, handleSyncWorkflowDraft])

  const handleZoomIn = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    zoomIn()
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, zoomIn, handleSyncWorkflowDraft])

  return {
    handleFitView,
    handleBackToOriginalSize,
    handleSizeToHalf,
    handleZoomOut,
    handleZoomIn,
  }
}

export const useWorkflowUpdate = () => {
  const reactflow = useReactFlow()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleUpdateWorkflowCanvas = useCallback((payload: WorkflowDataUpdater) => {
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
    handleUpdateWorkflowCanvas,
  }
}

export const useWorkflowCanvasMaximize = () => {
  const { eventEmitter } = useEventEmitterContextContext()

  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const setMaximizeCanvas = useStore(s => s.setMaximizeCanvas)
  const {
    getNodesReadOnly,
  } = useNodesReadOnly()

  const handleToggleMaximizeCanvas = useCallback(() => {
    if (getNodesReadOnly())
      return

    setMaximizeCanvas(!maximizeCanvas)
    localStorage.setItem('workflow-canvas-maximize', String(!maximizeCanvas))
    eventEmitter?.emit({
      type: 'workflow-canvas-maximize',
      payload: !maximizeCanvas,
    } as any)
  }, [eventEmitter, getNodesReadOnly, maximizeCanvas, setMaximizeCanvas])

  return {
    handleToggleMaximizeCanvas,
  }
}
