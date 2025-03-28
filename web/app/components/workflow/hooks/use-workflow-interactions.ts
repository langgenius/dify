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
  ITERATION_PADDING,
  WORKFLOW_DATA_UPDATE,
  X_OFFSET,
  Y_OFFSET,
} from '../constants'
import type { Node, WorkflowDataUpdater } from '../types'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import { ControlMode } from '../types'
import {
  getLayoutByDagre,
  initialEdges,
  initialNodes,
} from '../utils'
import {
  useNodesReadOnly,
  useSelectionInteractions,
  useWorkflowReadOnly,
} from '../hooks'
import { useEdgesInteractions } from './use-edges-interactions'
import { useNodesInteractions } from './use-nodes-interactions'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { WorkflowHistoryEvent, useWorkflowHistory } from './use-workflow-history'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { fetchWorkflowDraft } from '@/service/workflow'
import { exportAppConfig } from '@/service/apps'
import { useToastContext } from '@/app/components/base/toast'
import { useStore as useAppStore } from '@/app/components/app/store'

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
    const layout = getLayoutByDagre(nodes, edges)
    const rankMap = {} as Record<string, Node>

    nodes.forEach((node) => {
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

    const parentChildrenMap: Record<string, Node[]> = {}
    const nodeTargetsMap: Record<string, string[]> = {}

    nodes.forEach((node) => {
      if (node.parentId) {
        if (!parentChildrenMap[node.parentId])
          parentChildrenMap[node.parentId] = []
        parentChildrenMap[node.parentId].push(node)
      }
    })

    edges.forEach((edge) => {
      if (!nodeTargetsMap[edge.source])
        nodeTargetsMap[edge.source] = []
      nodeTargetsMap[edge.source].push(edge.target)
    })

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (!node.parentId && node.type === CUSTOM_NODE) {
          const nodeWithPosition = layout.node(node.id)

          node.position = {
            x: nodeWithPosition.x - node.width! / 2,
            y: nodeWithPosition.y - node.height! / 2 + rankMap[nodeWithPosition.rank!].height! / 2,
          }
        }
      })

      const iterationNodesToResize: string[] = []

      const layoutIterationChildren = (
        parentNode: Node<IterationNodeType | LoopNodeType>,
        childrenNodes: Node[],
        nodeTargetsMap: Record<string, string[]>,
      ) => {
        const startNodeId = parentNode.data.start_node_id
        const startNode = childrenNodes.find(n => n.id === startNodeId)

        if (!startNode) return

        iterationNodesToResize.push(parentNode.id)
        const nonStartNodes = childrenNodes.filter(n => n.id !== startNodeId)

        const startX = startNode.position.x + startNode.width! + X_OFFSET
        const startY = startNode.position.y

        const multiOutputChildrenMap: Record<string, Node[]> = {}
        nonStartNodes.forEach((node) => {
          const targets = nodeTargetsMap[node.id] || []
          if (targets.length > 1) {
            targets.forEach((targetId) => {
              const targetNode = nonStartNodes.find(n => n.id === targetId)
              if (targetNode) {
                if (!multiOutputChildrenMap[node.id])
                  multiOutputChildrenMap[node.id] = []
                multiOutputChildrenMap[node.id].push(targetNode)
              }
            })
          }
        })

        let horizontalIndex = 0
        const processedNodes = new Set<string>()

        nonStartNodes.forEach((node) => {
          const isMultiOutputTarget = Object.values(multiOutputChildrenMap).some(
            targets => targets.some(target => target.id === node.id),
          )

          if (!isMultiOutputTarget && !processedNodes.has(node.id)) {
            const nodeInDraft = draft.find(n => n.id === node.id)
            if (nodeInDraft) {
              nodeInDraft.position = {
                x: startX + horizontalIndex * (node.width! + X_OFFSET),
                y: startY,
              }
              horizontalIndex++
              processedNodes.add(node.id)

              if (multiOutputChildrenMap[node.id]?.length) {
                const targetNodes = multiOutputChildrenMap[node.id]

                let offsetY = -Math.max(0, (targetNodes.length - 1) * (targetNodes[0].height! + Y_OFFSET) / 2)

                if (startY + offsetY < ITERATION_PADDING.top)
                  offsetY = ITERATION_PADDING.top - startY

                targetNodes.forEach((targetNode) => {
                  const targetInDraft = draft.find(n => n.id === targetNode.id)
                  if (targetInDraft && !processedNodes.has(targetNode.id)) {
                    targetInDraft.position = {
                      x: nodeInDraft.position.x + nodeInDraft.width! + X_OFFSET,
                      y: nodeInDraft.position.y + offsetY,
                    }
                    processedNodes.add(targetNode.id)
                    offsetY += targetNode.height! + Y_OFFSET
                  }
                })
              }
            }
          }
        })

        nonStartNodes.forEach((node) => {
          if (!processedNodes.has(node.id)) {
            const nodeInDraft = draft.find(n => n.id === node.id)
            if (nodeInDraft) {
              nodeInDraft.position = {
                x: startX + horizontalIndex * (node.width! + X_OFFSET),
                y: startY,
              }
              horizontalIndex++
              processedNodes.add(node.id)
            }
          }
        })
      }

      draft.forEach((parentNode) => {
        const childrenNodes = parentChildrenMap[parentNode.id]
        if (childrenNodes && childrenNodes.length > 1)
          layoutIterationChildren(parentNode, childrenNodes, nodeTargetsMap)
      })

      iterationNodesToResize.forEach((nodeId) => {
        const parentNode = draft.find(n => n.id === nodeId)
        if (!parentNode) return

        const childrenNodes = draft.filter(n => n.parentId === nodeId)
        if (!childrenNodes.length) return

        const maxRight = Math.max(...childrenNodes.map(n => n.position.x + n.width!))
        const maxBottom = Math.max(...childrenNodes.map(n => n.position.y + n.height!))

        const newWidth = maxRight + ITERATION_PADDING.right
        const newHeight = maxBottom + ITERATION_PADDING.bottom

        parentNode.width = newWidth
        parentNode.height = newHeight
        if (parentNode.data) {
          parentNode.data.width = newWidth
          parentNode.data.height = newHeight
        }
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
  const workflowStore = useWorkflowStore()
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

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      appId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
      setConversationVariables,
    } = workflowStore.getState()
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`).then((response) => {
      handleUpdateWorkflowCanvas(response.graph as WorkflowDataUpdater)
      setSyncWorkflowDraftHash(response.hash)
      setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
        acc[env.id] = env.value
        return acc
      }, {} as Record<string, string>))
      setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
      // #TODO chatVar sync#
      setConversationVariables(response.conversation_variables || [])
    }).finally(() => setIsSyncingWorkflowDraft(false))
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleUpdateWorkflowCanvas,
    handleRefreshWorkflowDraft,
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
    catch (e) {
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
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }, [appDetail, eventEmitter, handleExportDSL, notify, t])

  return {
    exportCheck,
    handleExportDSL,
  }
}
