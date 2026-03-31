import { useCallback } from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'
import {
  getLayoutByELK,
  getLayoutForChildNodes,
} from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'
import {
  applyContainerSizeChanges,
  applyLayoutToNodes,
  getContainerSizeChanges,
  getLayoutContainerNodes,
} from './use-workflow-organize.helpers'

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
    const nodes = getNodes()
    const parentNodes = getLayoutContainerNodes(nodes)

    const childLayoutEntries = await Promise.all(
      parentNodes.map(async node => [node.id, await getLayoutForChildNodes(node.id, nodes, edges)] as const),
    )
    const childLayoutsMap = childLayoutEntries.reduce((acc, [nodeId, layout]) => {
      if (layout)
        acc[nodeId] = layout
      return acc
    }, {} as Record<string, NonNullable<Awaited<ReturnType<typeof getLayoutForChildNodes>>>>)

    const nodesWithUpdatedSizes = applyContainerSizeChanges(
      nodes,
      getContainerSizeChanges(parentNodes, childLayoutsMap),
    )
    const layout = await getLayoutByELK(nodesWithUpdatedSizes, edges)
    const nextNodes = applyLayoutToNodes({
      nodes: nodesWithUpdatedSizes,
      layout,
      parentNodes,
      childLayoutsMap,
    })

    setNodes(nextNodes)
    reactflow.setViewport({ x: 0, y: 0, zoom: 0.7 })
    saveStateToHistory(WorkflowHistoryEvent.LayoutOrganize)
    setTimeout(() => {
      handleSyncWorkflowDraft()
    })
  }, [getNodesReadOnly, handleSyncWorkflowDraft, reactflow, saveStateToHistory, store, workflowStore])

  return {
    handleLayout,
  }
}
