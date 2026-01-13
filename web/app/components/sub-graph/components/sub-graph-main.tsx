import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData, useSubGraphPersistence } from '../hooks'
import SubGraphChildren from './sub-graph-children'

type SubGraphMainProps = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  toolNodeId: string
  paramKey: string
  onSave?: (nodes: Node[], edges: Edge[]) => void
}

const SubGraphMain: FC<SubGraphMainProps> = ({
  nodes,
  edges,
  viewport,
  toolNodeId,
  paramKey,
  onSave,
}) => {
  const reactFlowStore = useStoreApi()
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { updateSubGraphConfig } = useSubGraphPersistence({ toolNodeId, paramKey })

  const handleSyncSubGraphDraft = useCallback(() => {
    const { getNodes, edges } = reactFlowStore.getState()
    onSave?.(getNodes() as Node[], edges as Edge[])
  }, [onSave, reactFlowStore])

  const hooksStore = useMemo(() => ({
    interactionMode: 'subgraph',
    availableNodesMetaData,
    doSyncWorkflowDraft: async () => {
      handleSyncSubGraphDraft()
    },
    syncWorkflowDraftWhenPageClose: handleSyncSubGraphDraft,
  }), [availableNodesMetaData, handleSyncSubGraphDraft])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
      allowSelectionWhenReadOnly
      canvasReadOnly
      interactionMode="subgraph"
    >
      <SubGraphChildren
        toolNodeId={toolNodeId}
        paramKey={paramKey}
        onConfigChange={updateSubGraphConfig}
      />
    </WorkflowWithInnerContext>
  )
}

export default SubGraphMain
