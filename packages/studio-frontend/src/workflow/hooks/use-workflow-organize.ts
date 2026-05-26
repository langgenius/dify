import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store/index'
import {
  getLayoutByELK,
  getLayoutForChildNodes,
} from '@/app/components/workflow/utils/elk-layout'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from '@/app/components/workflow/hooks/use-workflow-history'
import {
  applyContainerSizeChanges,
  applyLayoutToNodes,
  getContainerSizeChanges,
  getLayoutContainerNodes,
} from '@/app/components/workflow/hooks/use-workflow-organize.helpers'

export const useWorkflowOrganize = () => {
  const workflowStore = useWorkflowStore()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const reactflow = useReactFlow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleLayout = useCallback(async () => {
    if (getNodesReadOnly())
      return

    workflowStore.setState({ nodeAnimation: true })
    const {
      nodes,
      edges,
      setNodes,
    } = collaborativeWorkflow.getState()
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
  }, [getNodesReadOnly, handleSyncWorkflowDraft, reactflow, saveStateToHistory, collaborativeWorkflow, workflowStore])

  return {
    handleLayout,
  }
}
