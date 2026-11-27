import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { reportRequestError } from '@/app/query-error-toast'
import { fetchPipelineWorkflowDraft } from '@/service/workflow'
import { processNodesWithoutDataSource } from '../utils'

export const usePipelineRefreshDraft = () => {
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
      setRagPipelineVariables,
    } = workflowStore.getState()
    setIsSyncingWorkflowDraft(true)
    fetchPipelineWorkflowDraft(pipelineId)
      .then((response) => {
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
      })
      // The canvas keeps its current graph, so the failed reload is reported here.
      .catch(reportRequestError)
      .finally(() => setIsSyncingWorkflowDraft(false))
  }, [handleUpdateWorkflowCanvas, workflowStore, pipelineId])

  return {
    handleRefreshWorkflowDraft,
  }
}
