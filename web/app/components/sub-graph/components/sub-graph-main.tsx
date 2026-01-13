import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData, useSubGraphPersistence } from '../hooks'
import SubGraphChildren from './sub-graph-children'

type SubGraphMainProps = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  toolNodeId: string
  paramKey: string
}

const SubGraphMain: FC<SubGraphMainProps> = ({
  nodes,
  edges,
  viewport,
  toolNodeId,
  paramKey,
}) => {
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { updateSubGraphConfig } = useSubGraphPersistence({ toolNodeId, paramKey })

  const hooksStore = useMemo(() => {
    return {
      interactionMode: 'subgraph',
      availableNodesMetaData,
      doSyncWorkflowDraft: async () => {},
      syncWorkflowDraftWhenPageClose: () => {},
      handleRefreshWorkflowDraft: () => {},
      handleBackupDraft: () => {},
      handleLoadBackupDraft: () => {},
      handleRestoreFromPublishedWorkflow: () => {},
      handleRun: () => {},
      handleStopRun: () => {},
      handleStartWorkflowRun: () => {},
      handleWorkflowStartRunInWorkflow: () => {},
      handleWorkflowStartRunInChatflow: () => {},
      handleWorkflowTriggerScheduleRunInWorkflow: () => {},
      handleWorkflowTriggerWebhookRunInWorkflow: () => {},
      handleWorkflowTriggerPluginRunInWorkflow: () => {},
      handleWorkflowRunAllTriggersInWorkflow: () => {},
      getWorkflowRunAndTraceUrl: () => ({ runUrl: '', traceUrl: '' }),
      exportCheck: async () => {},
      handleExportDSL: async () => {},
      fetchInspectVars: async () => {},
      hasNodeInspectVars: () => false,
      hasSetInspectVar: () => false,
      fetchInspectVarValue: async () => {},
      editInspectVarValue: async () => {},
      renameInspectVarName: async () => {},
      appendNodeInspectVars: () => {},
      deleteInspectVar: async () => {},
      deleteNodeInspectorVars: async () => {},
      deleteAllInspectorVars: async () => {},
      isInspectVarEdited: () => false,
      resetToLastRunVar: async () => {},
      invalidateSysVarValues: () => {},
      resetConversationVar: async () => {},
      invalidateConversationVarValues: () => {},
    }
  }, [availableNodesMetaData])

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
