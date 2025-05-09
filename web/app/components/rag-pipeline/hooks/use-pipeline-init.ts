import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { usePipelineTemplate } from './use-pipeline-template'
import {
  fetchNodesDefaultConfigs,
  fetchPublishedWorkflow,
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
// import { useWorkflowConfig } from '@/service/use-workflow'

export const usePipelineInit = () => {
  const { datasetId } = useParams()
  const workflowStore = useWorkflowStore()
  const {
    nodes: nodesTemplate,
    edges: edgesTemplate,
  } = usePipelineTemplate()
  const setSyncWorkflowDraftHash = useStore(s => s.setSyncWorkflowDraftHash)
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    // workflowStore.setState({ pipelineId: datasetId as string })
  }, [datasetId, workflowStore])

  const handleUpdateWorkflowConfig = useCallback((config: Record<string, any>) => {
    const { setWorkflowConfig } = workflowStore.getState()

    setWorkflowConfig(config)
  }, [workflowStore])
  // useWorkflowConfig(`/rag/pipeline/${datasetId}/workflows/draft/config`, handleUpdateWorkflowConfig)

  const handleGetInitialWorkflowData = useCallback(async () => {
    try {
      const res = await fetchWorkflowDraft(`/rag/pipeline/${datasetId}/workflows/draft`)
      setData(res)
      workflowStore.setState({
        envSecrets: (res.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>),
        environmentVariables: res.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [],
      })
      setSyncWorkflowDraftHash(res.hash)
      setIsLoading(false)
    }
    catch (error: any) {
      if (error && error.json && !error.bodyUsed && datasetId) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_exist') {
            workflowStore.setState({ notInitialWorkflow: true })
            syncWorkflowDraft({
              url: `/rag/pipeline/${datasetId}/workflows/draft`,
              params: {
                graph: {
                  nodes: nodesTemplate,
                  edges: edgesTemplate,
                },
                environment_variables: [],
              },
            }).then((res) => {
              workflowStore.getState().setDraftUpdatedAt(res.updated_at)
              handleGetInitialWorkflowData()
            })
          }
        })
      }
    }
  }, [nodesTemplate, edgesTemplate, workflowStore, setSyncWorkflowDraftHash, datasetId])

  useEffect(() => {
    // handleGetInitialWorkflowData()

  }, [])

  const handleFetchPreloadData = useCallback(async () => {
    try {
      const nodesDefaultConfigsData = await fetchNodesDefaultConfigs(`/rag/pipeline/${datasetId}/workflows/default-workflow-block-configs`)
      const publishedWorkflow = await fetchPublishedWorkflow(`/rag/pipeline/${datasetId}/workflows/publish`)
      workflowStore.setState({
        nodesDefaultConfigs: nodesDefaultConfigsData.reduce((acc, block) => {
          if (!acc[block.type])
            acc[block.type] = { ...block.config }
          return acc
        }, {} as Record<string, any>),
      })
      workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at)
    }
    catch (e) {
      console.error(e)
    }
  }, [workflowStore, datasetId])

  useEffect(() => {
    // handleFetchPreloadData()
  }, [handleFetchPreloadData])

  useEffect(() => {
    if (data) {
      workflowStore.getState().setDraftUpdatedAt(data.updated_at)
      workflowStore.getState().setToolPublished(data.tool_published)
    }
  }, [data, workflowStore])

  return {
    data,
    isLoading,
  }
}
