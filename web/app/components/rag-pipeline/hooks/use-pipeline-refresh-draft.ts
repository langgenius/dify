import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useRagPipelineStore } from '../store'
import { processNodesWithoutDataSource } from '../utils'

export const usePipelineRefreshDraft = () => {
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useRagPipelineStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      setSyncWorkflowDraftHash,
      setEnvironmentVariables,
      setEnvSecrets,
      setRagPipelineVariables,
    } = workflowStore.getState()
    const generation = workflowStore.getState().pipelineDraftGeneration + 1
    workflowStore.setState({ pipelineDraftGeneration: generation, isSyncingWorkflowDraft: true })
    return workflowStore.getState().enqueuePipelineDraftOperation(async () => {
      try {
        if (generation !== workflowStore.getState().pipelineDraftGeneration) return
        const response = await fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`)
        if (generation !== workflowStore.getState().pipelineDraftGeneration) return
        const { nodes: processedNodes, viewport } = processNodesWithoutDataSource(
          response.graph.nodes,
          response.graph.viewport,
        )
        handleUpdateWorkflowCanvas({
          ...response.graph,
          nodes: processedNodes,
          viewport,
        } as WorkflowDataUpdater)
        setSyncWorkflowDraftHash(response.hash)
        setEnvSecrets(
          (response.environment_variables || [])
            .filter((env) => env.value_type === 'secret')
            .reduce(
              (acc, env) => {
                if (typeof env.value === 'string') acc[env.id] = env.value
                return acc
              },
              {} as Record<string, string>,
            ),
        )
        setEnvironmentVariables(
          response.environment_variables?.map((env) =>
            env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
          ) || [],
        )
        setRagPipelineVariables?.(response.rag_pipeline_variables || [])
      } finally {
        if (generation === workflowStore.getState().pipelineDraftGeneration)
          workflowStore.getState().setIsSyncingWorkflowDraft(false)
      }
    })
  }, [handleUpdateWorkflowCanvas, workflowStore, pipelineId])

  return {
    handleRefreshWorkflowDraft,
  }
}
