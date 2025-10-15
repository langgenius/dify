import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { usePipelineTemplate } from './use-pipeline-template'
import {
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePipelineConfig } from './use-pipeline-config'

export const usePipelineInit = () => {
  const workflowStore = useWorkflowStore()
  const {
    nodes: nodesTemplate,
    edges: edgesTemplate,
  } = usePipelineTemplate()
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  const datasetId = useDatasetDetailContextWithSelector(s => s.dataset)?.pipeline_id
  const knowledgeName = useDatasetDetailContextWithSelector(s => s.dataset)?.name
  const knowledgeIcon = useDatasetDetailContextWithSelector(s => s.dataset)?.icon_info

  useEffect(() => {
    workflowStore.setState({ pipelineId: datasetId, knowledgeName, knowledgeIcon })
  }, [datasetId, workflowStore, knowledgeName, knowledgeIcon])

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
      const res = await fetchWorkflowDraft(`/rag/pipelines/${datasetId}/workflows/draft`)
      setData(res)
      setDraftUpdatedAt(res.updated_at)
      setToolPublished(res.tool_published)
      setEnvSecrets((res.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
        acc[env.id] = env.value
        return acc
      }, {} as Record<string, string>))
      setEnvironmentVariables(res.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
      setSyncWorkflowDraftHash(res.hash)
      setRagPipelineVariables?.(res.rag_pipeline_variables || [])
      setIsLoading(false)
    }
    catch (error: any) {
      if (error && error.json && !error.bodyUsed && datasetId) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_exist') {
            workflowStore.setState({ notInitialWorkflow: true })
            syncWorkflowDraft({
              url: `/rag/pipelines/${datasetId}/workflows/draft`,
              params: {
                graph: {
                  nodes: nodesTemplate,
                  edges: edgesTemplate,
                },
                environment_variables: [],
              },
            }).then((res) => {
              const { setDraftUpdatedAt } = workflowStore.getState()
              setDraftUpdatedAt(res.updated_at)
              handleGetInitialWorkflowData()
            })
          }
        })
      }
    }
  }, [nodesTemplate, edgesTemplate, workflowStore, datasetId])

  useEffect(() => {
    handleGetInitialWorkflowData()
  }, [])

  return {
    data,
    isLoading,
  }
}
