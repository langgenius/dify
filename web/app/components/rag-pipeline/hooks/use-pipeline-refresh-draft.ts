import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { processNodesWithoutDataSource } from '../utils'

export const usePipelineRefreshDraft = () => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      pipelineId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
    } = workflowStore.getState()
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`).then((response) => {
      const {
        nodes: processedNodes,
        viewport,
      } = processNodesWithoutDataSource(response.graph.nodes, response.graph.viewport)
      handleUpdateWorkflowCanvas({
        ...response.graph,
        nodes: processedNodes,
        viewport,
      } as WorkflowDataUpdater)
      setSyncWorkflowDraftHash(response.hash)
      setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
        acc[env.id] = env.value
        return acc
      }, {} as Record<string, string>))
      setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
    }).finally(() => setIsSyncingWorkflowDraft(false))
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
