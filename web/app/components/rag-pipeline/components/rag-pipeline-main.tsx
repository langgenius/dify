import type { WorkflowProps } from '@/app/components/workflow'
import {
  useCallback,
  useMemo,
} from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { getDatasetACLCapabilities } from '@/utils/permission'
import {
  useAvailableNodesMetaData,
  useDSLByCanEdit,
  useGetRunAndTraceUrl,
  useNodesSyncDraftByCanEdit,
  usePipelineRefreshDraft,
  usePipelineRunByCanEdit,
  usePipelineStartRunByCanEdit,
} from '../hooks'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import RagPipelineChildren from './rag-pipeline-children'

type RagPipelineMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const RagPipelineMain = ({
  nodes,
  edges,
  viewport,
}: RagPipelineMainProps) => {
  const workflowStore = useWorkflowStore()
  const dataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const datasetACLCapabilities = useMemo(
    () => getDatasetACLCapabilities(dataset?.permission_keys, {
      currentUserId,
      resourceMaintainer: dataset?.maintainer,
      workspacePermissionKeys,
    }),
    [dataset?.maintainer, dataset?.permission_keys, currentUserId, workspacePermissionKeys],
  )

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
  } = useNodesSyncDraftByCanEdit(datasetACLCapabilities.canEdit)
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = usePipelineRunByCanEdit(datasetACLCapabilities.canEdit)
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  } = usePipelineStartRunByCanEdit(datasetACLCapabilities.canEdit)
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const {
    exportCheck,
    handleExportDSL,
  } = useDSLByCanEdit(datasetACLCapabilities.canEdit)

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
      accessControl: {
        canEdit: datasetACLCapabilities.canEdit,
        canComment: datasetACLCapabilities.canReadonly || datasetACLCapabilities.canEdit,
        canRun: datasetACLCapabilities.canPipelineTest,
        canImportExportDSL: datasetACLCapabilities.canImportExportDSL,
        canReleaseAndVersion: datasetACLCapabilities.canPipelineRelease,
      },
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
    datasetACLCapabilities,
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
