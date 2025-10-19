import {
  useCallback,
  useMemo,
} from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import RagPipelineChildren from './rag-pipeline-children'
import {
  useAvailableNodesMetaData,
  useDSL,
  useGetRunAndTraceUrl,
  useNodesSyncDraft,
  usePipelineRefreshDraft,
  usePipelineRun,
  usePipelineStartRun,
} from '../hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'

type RagPipelineMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const RagPipelineMain = ({
  nodes,
  edges,
  viewport,
}: RagPipelineMainProps) => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowDataUpdate = useCallback((payload: any) => {
    const {
      rag_pipeline_variables,
      environment_variables,
    } = payload
    if (rag_pipeline_variables) {
      const { setRagPipelineVariables } = workflowStore.getState()
      setRagPipelineVariables?.(rag_pipeline_variables)
    }
    if (environment_variables) {
      const { setEnvironmentVariables } = workflowStore.getState()
      setEnvironmentVariables(environment_variables)
    }
  }, [workflowStore])

  const {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft()
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = usePipelineRun()
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  } = usePipelineStartRun()
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const {
    exportCheck,
    handleExportDSL,
  } = useDSL()

  const configsMap = useConfigsMap()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    ...configsMap,
  })
  const {
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
  } = useInspectVarsCrud()

  const hooksStore = useMemo(() => {
    return {
      availableNodesMetaData,
      syncWorkflowDraftWhenPageClose,
      doSyncWorkflowDraft,
      handleRefreshWorkflowDraft,
      handleBackupDraft,
      handleLoadBackupDraft,
      handleRestoreFromPublishedWorkflow,
      handleRun,
      handleStopRun,
      handleStartWorkflowRun,
      handleWorkflowStartRunInWorkflow,
      getWorkflowRunAndTraceUrl,
      exportCheck,
      handleExportDSL,
      fetchInspectVars,
      hasNodeInspectVars,
      hasSetInspectVar,
      fetchInspectVarValue,
      editInspectVarValue,
      renameInspectVarName,
      appendNodeInspectVars,
      deleteInspectVar,
      deleteNodeInspectorVars,
      deleteAllInspectorVars,
      isInspectVarEdited,
      resetToLastRunVar,
      invalidateSysVarValues,
      resetConversationVar,
      invalidateConversationVarValues,
      configsMap,
    }
  }, [
    availableNodesMetaData,
    syncWorkflowDraftWhenPageClose,
    doSyncWorkflowDraft,
    handleRefreshWorkflowDraft,
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    getWorkflowRunAndTraceUrl,
    exportCheck,
    handleExportDSL,
    fetchInspectVars,
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
    configsMap,
  ])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
      onWorkflowDataUpdate={handleWorkflowDataUpdate}
    >
      <RagPipelineChildren />
    </WorkflowWithInnerContext>
  )
}

export default RagPipelineMain
