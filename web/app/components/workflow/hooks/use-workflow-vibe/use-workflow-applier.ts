import type { BackendEdgeSpec, BackendNodeSpec } from '@/service/debug'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Toast from '@/app/components/base/toast'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useWorkflowHistory, WorkflowHistoryEvent } from '../../hooks/use-workflow-history'
import { useWorkflowStore } from '../../store'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../../utils'
import { useVibeGraphParser } from './use-vibe-graph-parser'
import { dedupeHandles } from './utils'

export const useWorkflowApplier = () => {
  const { t } = useTranslation('workflow')
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { createGraphFromBackendNodes } = useVibeGraphParser()

  const applyBackendNodesToWorkflow = useCallback(async (
    backendNodes: BackendNodeSpec[],
    backendEdges: BackendEdgeSpec[],
  ) => {
    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const nodes = getNodes()
    const {
      setShowVibePanel,
    } = workflowStore.getState()

    const { nodes: newNodes, edges: newEdges } = await createGraphFromBackendNodes(backendNodes, backendEdges)

    if (newNodes.length === 0) {
      setShowVibePanel(false)
      return
    }

    const allNodes = [...nodes, ...newNodes]
    const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      newEdges.map(edge => ({ type: 'add', edge })),
      allNodes,
    )

    const updatedNodes = allNodes.map((node) => {
      const connected = nodesConnectedMap[node.id]
      if (!connected)
        return node

      return {
        ...node,
        data: {
          ...node.data,
          ...connected,
          _connectedSourceHandleIds: dedupeHandles(connected._connectedSourceHandleIds),
          _connectedTargetHandleIds: dedupeHandles(connected._connectedTargetHandleIds),
        },
      }
    })

    setNodes(updatedNodes)
    setEdges([...edges, ...newEdges])
    saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: newNodes[0].id })
    handleSyncWorkflowDraft()

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
    }))
  }, [
    createGraphFromBackendNodes,
    handleSyncWorkflowDraft,
    saveStateToHistory,
    store,
    workflowStore,
  ])

  // Note: the original code had 'applyFlowchartToWorkflow' take no arguments and use 'currentVibeFlow' from store.
  // We can keep that signature or make it more flexible.
  // For 'handleAccept' it uses currentVibeFlow.
  // For 'handleVibeCommand' -> 'skipPanelPreview', it calls it with *generated* mermaid code?
  // Wait, in `handleVibeCommand` line 1524: `await applyFlowchartToWorkflow()`
  // It relies on `addVibeFlowVersion` being called just before line 1510.
  // So keeping it as "apply from current vibe flow" is consistent with existing logic where state is central.

  const applyFlowchartToWorkflow = useCallback(() => {
    const currentFlowGraph = workflowStore.getState().currentVibeFlow

    if (!currentFlowGraph || !currentFlowGraph.nodes || currentFlowGraph.nodes.length === 0) {
      Toast.notify({ type: 'error', message: t('vibe.invalidFlowchart') })
      return
    }

    const { setNodes, setEdges } = store.getState()
    const vibePanelPreviewNodes = currentFlowGraph.nodes || []
    const vibePanelPreviewEdges = currentFlowGraph.edges || []

    setNodes(vibePanelPreviewNodes)
    setEdges(vibePanelPreviewEdges)
    saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: vibePanelPreviewNodes[0].id })
    handleSyncWorkflowDraft(true, true)

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
    }))
  }, [
    handleSyncWorkflowDraft,
    saveStateToHistory,
    store,
    t,
    workflowStore,
  ])

  const handleAccept = useCallback(async () => {
    // Prefer backend nodes (already sanitized) over mermaid re-parsing
    const { vibePanelBackendNodes, vibePanelBackendEdges } = workflowStore.getState()
    if (vibePanelBackendNodes && vibePanelBackendNodes.length > 0 && vibePanelBackendEdges) {
      await applyBackendNodesToWorkflow(vibePanelBackendNodes, vibePanelBackendEdges)
    }
    else {
      applyFlowchartToWorkflow()
    }
  }, [applyBackendNodesToWorkflow, applyFlowchartToWorkflow, workflowStore])

  return {
    applyBackendNodesToWorkflow,
    applyFlowchartToWorkflow,
    handleAccept,
  }
}
