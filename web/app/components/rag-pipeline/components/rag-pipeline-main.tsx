import type { WorkflowProps } from '@/app/components/workflow'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getDatasetACLCapabilities } from '@/utils/permission'
import { useAvailableNodesMetaData } from '../hooks/use-available-nodes-meta-data'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useDSLByCanEdit } from '../hooks/use-DSL'
import { useGetRunAndTraceUrl } from '../hooks/use-get-run-and-trace-url'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import { useNodesSyncDraftByCanEdit } from '../hooks/use-nodes-sync-draft'
import { usePipelineRefreshDraft } from '../hooks/use-pipeline-refresh-draft'
import { usePipelineRunByCanEdit } from '../hooks/use-pipeline-run'
import { usePipelineStartRunByCanEdit } from '../hooks/use-pipeline-start-run'
import RagPipelineChildren from './rag-pipeline-children'

type RagPipelineMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const RagPipelineMain = ({ nodes, edges, viewport }: RagPipelineMainProps) => {
  const workflowStore = useWorkflowStore()
  const dataset = useDatasetDetailContextWithSelector((s) => s.dataset)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const datasetACLCapabilities = useMemo(
    () =>
      getDatasetACLCapabilities(dataset?.permission_keys, {
        currentUserId,
        resourceMaintainer: dataset?.maintainer,
        workspacePermissionKeys,
      }),
    [dataset?.maintainer, dataset?.permission_keys, currentUserId, workspacePermissionKeys],
  )

  type WorkflowDataUpdatePayload = {
    rag_pipeline_variables?: Parameters<
      NonNullable<ReturnType<typeof workflowStore.getState>['setRagPipelineVariables']>
    >[0]
    environment_variables?: Parameters<
      ReturnType<typeof workflowStore.getState>['setEnvironmentVariables']
    >[0]
  }

  const handleWorkflowDataUpdate = useCallback(
    (payload: WorkflowDataUpdatePayload) => {
      const { rag_pipeline_variables, environment_variables } = payload
      if (rag_pipeline_variables) {
        const { setRagPipelineVariables } = workflowStore.getState()
        setRagPipelineVariables?.(rag_pipeline_variables)
      }
      if (environment_variables) {
        const { setEnvironmentVariables } = workflowStore.getState()
        setEnvironmentVariables(environment_variables)
      }
    },
    [workflowStore],
  )

  const { doSyncWorkflowDraft, syncWorkflowDraftWhenPageClose } = useNodesSyncDraftByCanEdit(
    datasetACLCapabilities.canEdit,
  )
  const { handleRefreshWorkflowDraft } = usePipelineRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = usePipelineRunByCanEdit(datasetACLCapabilities.canEdit)
  const { handleStartWorkflowRun, handleWorkflowStartRunInWorkflow } = usePipelineStartRunByCanEdit(
    datasetACLCapabilities.canEdit,
  )
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const { exportCheck, handleExportDSL } = useDSLByCanEdit(datasetACLCapabilities.canEdit)

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
      hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
      onWorkflowDataUpdate={handleWorkflowDataUpdate}
    >
      <RagPipelineChildren />
    </WorkflowWithInnerContext>
  )
}

export default RagPipelineMain
