import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphConfig } from '../types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
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
  const {
    saveSubGraphData,
    loadSubGraphData,
    updateSubGraphConfig,
  } = useSubGraphPersistence({ toolNodeId, paramKey })

  const handleNodesChange = useCallback((updatedNodes: Node[]) => {
    const existingData = loadSubGraphData()
    const defaultConfig: SubGraphConfig = {
      enabled: true,
      startNodeId: updatedNodes[0]?.id || '',
      selectedOutputVar: [],
      whenOutputNone: 'skip',
    }

    saveSubGraphData({
      nodes: updatedNodes,
      edges,
      config: existingData?.config || defaultConfig,
    })
  }, [edges, loadSubGraphData, saveSubGraphData])

  const hooksStore = useMemo(() => {
    return {
      availableNodesMetaData,
      doSyncWorkflowDraft: async () => {
        handleNodesChange(nodes)
      },
      syncWorkflowDraftWhenPageClose: () => {
        handleNodesChange(nodes)
      },
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
  }, [availableNodesMetaData, handleNodesChange, nodes])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
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
