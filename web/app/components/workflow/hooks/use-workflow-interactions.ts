import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useStoreApi } from 'reactflow'
import produce from 'immer'
import { useStore, useWorkflowStore } from '../store'
import {
  CUSTOM_NODE, DSL_EXPORT_CHECK,
  NODE_LAYOUT_HORIZONTAL_PADDING,
  NODE_LAYOUT_VERTICAL_PADDING,
  WORKFLOW_DATA_UPDATE,
} from '../constants'
import type { Node, WorkflowDataUpdater } from '../types'
import { BlockEnum, ControlMode } from '../types'
import {
  getLayoutByDagre,
  getLayoutForChildNodes,
  initialEdges,
  initialNodes,
} from '../utils'
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
import { fetchWorkflowDraft } from '@/service/workflow'
import { exportAppConfig } from '@/service/apps'
import { useToastContext } from '@/app/components/base/toast'
import { useStore as useAppStore } from '@/app/components/app/store'

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

    const childLayoutsMap: Record<string, any> = {}
    loopAndIterationNodes.forEach((node) => {
      childLayoutsMap[node.id] = getLayoutForChildNodes(node.id, nodes, edges)
    })

    const containerSizeChanges: Record<string, { width: number, height: number }> = {}

    loopAndIterationNodes.forEach((parentNode) => {
      const childLayout = childLayoutsMap[parentNode.id]
      if (!childLayout) return

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let hasChildren = false

      const childNodes = nodes.filter(node => node.parentId === parentNode.id)

      childNodes.forEach((node) => {
        if (childLayout.node(node.id)) {
          hasChildren = true
          const childNodeWithPosition = childLayout.node(node.id)

          const nodeX = childNodeWithPosition.x - node.width! / 2
          const nodeY = childNodeWithPosition.y - node.height! / 2

          minX = Math.min(minX, nodeX)
          minY = Math.min(minY, nodeY)
          maxX = Math.max(maxX, nodeX + node.width!)
          maxY = Math.max(maxY, nodeY + node.height!)
        }
      })

      if (hasChildren) {
        const requiredWidth = maxX - minX + NODE_LAYOUT_HORIZONTAL_PADDING * 2
        const requiredHeight = maxY - minY + NODE_LAYOUT_VERTICAL_PADDING * 2

        containerSizeChanges[parentNode.id] = {
          width: Math.max(parentNode.width || 0, requiredWidth),
          height: Math.max(parentNode.height || 0, requiredHeight),
        }
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

    const layout = getLayoutByDagre(nodesWithUpdatedSizes, edges)

    const rankMap = {} as Record<string, Node>
    nodesWithUpdatedSizes.forEach((node) => {
      if (!node.parentId && node.type === CUSTOM_NODE) {
        const rank = layout.node(node.id).rank!

        if (!rankMap[rank]) {
          rankMap[rank] = node
        }
        else {
          if (rankMap[rank].position.y > node.position.y)
            rankMap[rank] = node
        }
      }
    })

    const newNodes = produce(nodesWithUpdatedSizes, (draft) => {
      draft.forEach((node) => {
        if (!node.parentId && node.type === CUSTOM_NODE) {
          const nodeWithPosition = layout.node(node.id)

          node.position = {
            x: nodeWithPosition.x - node.width! / 2,
            y: nodeWithPosition.y - node.height! / 2 + rankMap[nodeWithPosition.rank!].height! / 2,
          }
        }
      })

      loopAndIterationNodes.forEach((parentNode) => {
        const childLayout = childLayoutsMap[parentNode.id]
        if (!childLayout) return

        const childNodes = draft.filter(node => node.parentId === parentNode.id)

        let minX = Infinity
        let minY = Infinity

        childNodes.forEach((node) => {
          if (childLayout.node(node.id)) {
            const childNodeWithPosition = childLayout.node(node.id)
            const nodeX = childNodeWithPosition.x - node.width! / 2
            const nodeY = childNodeWithPosition.y - node.height! / 2

            minX = Math.min(minX, nodeX)
            minY = Math.min(minY, nodeY)
          }
        })

        childNodes.forEach((node) => {
          if (childLayout.node(node.id)) {
            const childNodeWithPosition = childLayout.node(node.id)

            node.position = {
              x: NODE_LAYOUT_HORIZONTAL_PADDING + (childNodeWithPosition.x - node.width! / 2 - minX),
              y: NODE_LAYOUT_VERTICAL_PADDING + (childNodeWithPosition.y - node.height! / 2 - minY),
            }
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

export const useDSL = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [exporting, setExporting] = useState(false)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const appDetail = useAppStore(s => s.appDetail)

  const handleExportDSL = useCallback(async (include = false) => {
    if (!appDetail)
      return

    if (exporting)
      return

    try {
      setExporting(true)
      await doSyncWorkflowDraft()
      const { data } = await exportAppConfig({
        appID: appDetail.id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      a.href = URL.createObjectURL(file)
      a.download = `${appDetail.name}.yml`
      a.click()
    }
    catch {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
    finally {
      setExporting(false)
    }
  }, [appDetail, notify, t, doSyncWorkflowDraft, exporting])

  const exportCheck = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail?.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        handleExportDSL()
        return
      }
      eventEmitter?.emit({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: list,
        },
      } as any)
    }
    catch {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }, [appDetail, eventEmitter, handleExportDSL, notify, t])

  return {
    exportCheck,
    handleExportDSL,
  }
}
