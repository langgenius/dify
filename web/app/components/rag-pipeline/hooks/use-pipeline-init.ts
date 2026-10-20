import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { ORPCError } from '@orpc/client'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toIconInfo } from '@/app/components/datasets/dataset-fields'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { consoleClient } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { usePipelineConfig } from './use-pipeline-config'
import { usePipelineTemplate } from './use-pipeline-template'

export const usePipelineInit = () => {
  const workflowStore = useWorkflowStore()
  const { nodes: nodesTemplate, edges: edgesTemplate } = usePipelineTemplate()
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const knowledgeName = useDatasetDetailContextWithSelector((s) => s.dataset)?.name
  const datasetIcon = useDatasetDetailContextWithSelector((s) => s.dataset?.icon_info)
  const knowledgeIcon = useMemo(() => toIconInfo(datasetIcon), [datasetIcon])

  useEffect(() => {
    workflowStore.setState({ knowledgeName, knowledgeIcon })
  }, [pipelineId, workflowStore, knowledgeName, knowledgeIcon])

  usePipelineConfig()

  const handleGetInitialWorkflowData = useCallback(async () => {
    const {
      setEnvSecrets,
      setEnvironmentVariables,
      setSyncWorkflowDraftHash,
      setDraftUpdatedAt,
      setToolPublished,
      setRagPipelineVariables,
    } = workflowStore.getState()
    try {
      const res = await fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`)
      setData(res)
      setDraftUpdatedAt(res.updated_at)
      setToolPublished(res.tool_published)
      setEnvSecrets(
        (res.environment_variables || [])
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
        res.environment_variables?.map((env) =>
          env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
        ) || [],
      )
      setSyncWorkflowDraftHash(res.hash)
      setRagPipelineVariables?.(res.rag_pipeline_variables || [])
      workflowStore.setState({ isWorkflowDataLoaded: true })
      setIsLoading(false)
    } catch (error: unknown) {
      if (error instanceof ORPCError && pipelineId) {
        if (error.code === 'draft_workflow_not_exist') {
          workflowStore.setState({
            notInitialWorkflow: true,
            shouldAutoOpenStartNodeSelector: true,
          })
          consoleClient.rag.pipelines.byPipelineId.workflows.draft
            .post(
              {
                params: { pipeline_id: pipelineId },
                body: {
                  graph: {
                    nodes: nodesTemplate,
                    edges: edgesTemplate,
                  },
                  environment_variables: [],
                },
              },
              { context: { silent: true } },
            )
            .then((res) => {
              const { setDraftUpdatedAt } = workflowStore.getState()
              setDraftUpdatedAt(res.updated_at)
              handleGetInitialWorkflowData()
            })
        }
      }
    }
  }, [nodesTemplate, edgesTemplate, workflowStore, pipelineId])

  useEffect(() => {
    handleGetInitialWorkflowData()
  }, [])

  return {
    data,
    isLoading,
  }
}
