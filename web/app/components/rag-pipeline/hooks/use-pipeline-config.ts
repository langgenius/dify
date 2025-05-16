import { useCallback } from 'react'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { useWorkflowConfig } from '@/service/use-workflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'

export const usePipelineConfig = () => {
  const pipelineId = useStore(s => s.pipelineId)
  const workflowStore = useWorkflowStore()

  const handleUpdateWorkflowConfig = useCallback((config: Record<string, any>) => {
    const { setWorkflowConfig } = workflowStore.getState()

    setWorkflowConfig(config)
  }, [workflowStore])
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/draft/config` : '',
    handleUpdateWorkflowConfig,
  )

  const handleUpdateNodesDefaultConfigs = useCallback((nodesDefaultConfigs: Record<string, any>) => {
    const { setNodesDefaultConfigs } = workflowStore.getState()

    setNodesDefaultConfigs!(nodesDefaultConfigs)
  }, [workflowStore])
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/default-workflow-block-configs` : '',
    handleUpdateNodesDefaultConfigs,
  )

  const handleUpdatePublishedAt = useCallback((publishedWorkflow: FetchWorkflowDraftResponse) => {
    const { setPublishedAt } = workflowStore.getState()

    setPublishedAt(publishedWorkflow?.created_at)
  }, [workflowStore])
  useWorkflowConfig(
    pipelineId ? `/rag/pipelines/${pipelineId}/workflows/publish` : '',
    handleUpdatePublishedAt,
  )
}
