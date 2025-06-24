import {
  useCallback,
  useMemo,
} from 'react'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import WorkflowChildren from './workflow-children'
import {
  useNodesSyncDraft,
  useWorkflowRefreshDraft,
  useWorkflowRun,
  useWorkflowStartRun,
} from '../hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'

type WorkflowMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const WorkflowMain = ({
  nodes,
  edges,
  viewport,
}: WorkflowMainProps) => {
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()

  const handleWorkflowDataUpdate = useCallback((payload: any) => {
    const {
      features,
      conversation_variables,
      environment_variables,
    } = payload
    if (features && featuresStore) {
      const { setFeatures } = featuresStore.getState()

      setFeatures(features)
    }
    if (conversation_variables) {
      const { setConversationVariables } = workflowStore.getState()
      setConversationVariables(conversation_variables)
    }
    if (environment_variables) {
      const { setEnvironmentVariables } = workflowStore.getState()
      setEnvironmentVariables(environment_variables)
    }
  }, [featuresStore, workflowStore])

  const {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useWorkflowRun()
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
  } = useWorkflowStartRun()

  const hooksStore = useMemo(() => {
    return {
      syncWorkflowDraftWhenPageClose,
      doSyncWorkflowDraft,
      handleRefreshWorkflowDraft,
      handleBackupDraft,
      handleLoadBackupDraft,
      handleRestoreFromPublishedWorkflow,
      handleRun,
      handleStopRun,
      handleStartWorkflowRun,
      handleWorkflowStartRunInChatflow,
      handleWorkflowStartRunInWorkflow,
    }
  }, [
    syncWorkflowDraftWhenPageClose,
    doSyncWorkflowDraft,
    handleRefreshWorkflowDraft,
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
  ])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      onWorkflowDataUpdate={handleWorkflowDataUpdate}
      hooksStore={hooksStore}
    >
      <WorkflowChildren />
    </WorkflowWithInnerContext>
  )
}

export default WorkflowMain
