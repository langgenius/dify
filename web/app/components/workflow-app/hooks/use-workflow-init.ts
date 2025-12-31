import type { Edge, Node } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useWorkflowConfig } from '@/service/use-workflow'
import {
  fetchNodesDefaultConfigs,
  fetchPublishedWorkflow,
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { useWorkflowTemplate } from './use-workflow-template'

const hasConnectedUserInput = (nodes: Node[] = [], edges: Edge[] = []): boolean => {
  const startNodeIds = nodes
    .filter(node => node?.data?.type === BlockEnum.Start)
    .map(node => node.id)

  if (!startNodeIds.length)
    return false

  return edges.some(edge => startNodeIds.includes(edge.source))
}
export const useWorkflowInit = () => {
  const workflowStore = useWorkflowStore()
  const {
    nodes: nodesTemplate,
    edges: edgesTemplate,
  } = useWorkflowTemplate()
  const appDetail = useAppStore(state => state.appDetail)!
  const setSyncWorkflowDraftHash = useStore(s => s.setSyncWorkflowDraftHash)
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    workflowStore.setState({ appId: appDetail.id, appName: appDetail.name })
  }, [appDetail.id, workflowStore])

  const handleUpdateWorkflowFileUploadConfig = useCallback((config: FileUploadConfigResponse) => {
    const { setFileUploadConfig } = workflowStore.getState()
    setFileUploadConfig(config)
  }, [workflowStore])
  const {
    data: fileUploadConfigResponse,
    isLoading: isFileUploadConfigLoading,
  } = useWorkflowConfig('/files/upload', handleUpdateWorkflowFileUploadConfig)

  const handleGetInitialWorkflowData = useCallback(async () => {
    try {
      const res = await fetchWorkflowDraft(`/apps/${appDetail.id}/workflows/draft`)
      setData(res)
      workflowStore.setState({
        envSecrets: (res.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>),
        environmentVariables: res.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [],
        conversationVariables: res.conversation_variables || [],
        isWorkflowDataLoaded: true,
      })
      setSyncWorkflowDraftHash(res.hash)
      setIsLoading(false)
    }
    catch (error: any) {
      if (error && error.json && !error.bodyUsed && appDetail) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_exist') {
            const isAdvancedChat = appDetail.mode === AppModeEnum.ADVANCED_CHAT
            workflowStore.setState({
              notInitialWorkflow: true,
              showOnboarding: !isAdvancedChat,
              shouldAutoOpenStartNodeSelector: !isAdvancedChat,
              hasShownOnboarding: false,
            })
            const nodesData = isAdvancedChat ? nodesTemplate : []
            const edgesData = isAdvancedChat ? edgesTemplate : []

            syncWorkflowDraft({
              url: `/apps/${appDetail.id}/workflows/draft`,
              params: {
                graph: {
                  nodes: nodesData,
                  edges: edgesData,
                },
                features: {
                  retriever_resource: { enabled: true },
                },
                environment_variables: [],
                conversation_variables: [],
              },
            }).then((res) => {
              workflowStore.getState().setDraftUpdatedAt(res.updated_at)
              handleGetInitialWorkflowData()
            })
          }
        })
      }
    }
  }, [appDetail, nodesTemplate, edgesTemplate, workflowStore, setSyncWorkflowDraftHash])

  useEffect(() => {
    handleGetInitialWorkflowData()
  }, [])

  const handleFetchPreloadData = useCallback(async () => {
    try {
      const nodesDefaultConfigsData = await fetchNodesDefaultConfigs(`/apps/${appDetail?.id}/workflows/default-workflow-block-configs`)
      const publishedWorkflow = await fetchPublishedWorkflow(`/apps/${appDetail?.id}/workflows/publish`)
      workflowStore.setState({
        nodesDefaultConfigs: nodesDefaultConfigsData.reduce((acc, block) => {
          if (!acc[block.type])
            acc[block.type] = { ...block.config }
          return acc
        }, {} as Record<string, any>),
      })
      workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at)
      const graph = publishedWorkflow?.graph
      workflowStore.getState().setLastPublishedHasUserInput(
        hasConnectedUserInput(graph?.nodes, graph?.edges),
      )
    }
    catch (e) {
      console.error(e)
      workflowStore.getState().setLastPublishedHasUserInput(false)
    }
  }, [workflowStore, appDetail])

  useEffect(() => {
    handleFetchPreloadData()
  }, [handleFetchPreloadData])

  useEffect(() => {
    if (data) {
      workflowStore.getState().setDraftUpdatedAt(data.updated_at)
      workflowStore.getState().setToolPublished(data.tool_published)
    }
  }, [data, workflowStore])

  return {
    data,
    isLoading: isLoading || isFileUploadConfigLoading,
    fileUploadConfigResponse,
  }
}
