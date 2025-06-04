import {
  useMemo,
} from 'react'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import RagPipelineChildren from './rag-pipeline-children'
import {
  useAvailableNodesMetaData,
  useGetRunAndTraceUrl,
  useNodesSyncDraft,
  usePipelineRefreshDraft,
  usePipelineRun,
  usePipelineStartRun,
} from '../hooks'

type RagPipelineMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const RagPipelineMain = ({
  nodes,
  edges,
  viewport,
}: RagPipelineMainProps) => {
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
  ])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
    >
      <RagPipelineChildren />
    </WorkflowWithInnerContext>
  )
}

export default RagPipelineMain
