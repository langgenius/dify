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
