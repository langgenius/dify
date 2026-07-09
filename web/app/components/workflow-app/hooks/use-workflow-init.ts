import type { Edge, Node } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useAtomValue } from 'jotai'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { userProfileIdAtom, workspacePermissionKeysAtom } from '@/context/app-context-state'
import { useWorkflowConfig } from '@/service/use-workflow'
import {
  fetchNodesDefaultConfigs,
  fetchPublishedWorkflow,
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'
import { useWorkflowTemplate } from './use-workflow-template'

const emptyAccount = {
  id: '',
  name: '',
  email: '',
}

const createLocalWorkflowDraft = (
  graph: FetchWorkflowDraftResponse['graph'],
): FetchWorkflowDraftResponse => ({
  id: '',
  graph,
  features: {
    retriever_resource: { enabled: true },
  },
  created_at: 0,
  created_by: emptyAccount,
  hash: '',
  updated_at: 0,
  updated_by: emptyAccount,
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  version: '',
  marked_name: '',
  marked_comment: '',
})

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
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = useMemo(() => getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  }), [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys])
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)
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
      const initialData = {
        ...res,
        graph: getWorkflowDraftGraphForCanvas(res.graph, {
          localStartPlaceholderNodes: nodesTemplate,
        }),
      }

      setData(initialData)
      workflowStore.setState({
        envSecrets: (initialData.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>),
        environmentVariables: initialData.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [],
        conversationVariables: initialData.conversation_variables || [],
        isWorkflowDataLoaded: true,
      })
      setSyncWorkflowDraftHash(initialData.hash)
      setIsLoading(false)
    }
    catch (error: unknown) {
      const responseError = error as { bodyUsed?: boolean, json?: () => Promise<{ code?: string }> }
      if (responseError.json && !responseError.bodyUsed && appDetail) {
        responseError.json().then((err) => {
          if (err.code === 'draft_workflow_not_exist') {
            const isAdvancedChat = appDetail.mode === AppModeEnum.ADVANCED_CHAT
            const initialGraph = {
              nodes: isAdvancedChat ? nodesTemplate : [],
              edges: isAdvancedChat ? edgesTemplate : [],
            }
            workflowStore.setState({
              notInitialWorkflow: true,
              showOnboarding: false,
              shouldAutoOpenStartNodeSelector: false,
              hasSelectedStartNode: false,
              hasShownOnboarding: !isAdvancedChat,
            })

            if (!appACLCapabilities.canEdit) {
              const initialData = createLocalWorkflowDraft({
                ...getWorkflowDraftGraphForCanvas(initialGraph, {
                  localStartPlaceholderNodes: nodesTemplate,
                }),
              })
              setData(initialData)
              workflowStore.setState({
                envSecrets: {},
                environmentVariables: [],
                conversationVariables: [],
                isWorkflowDataLoaded: true,
              })
              setSyncWorkflowDraftHash(initialData.hash)
              setIsLoading(false)
              return
            }

            syncWorkflowDraft({
              url: `/apps/${appDetail.id}/workflows/draft`,
              params: {
                graph: initialGraph,
                features: {
                  retriever_resource: { enabled: true },
                },
                environment_variables: [],
                conversation_variables: [],
              },
            }).then((res) => {
              workflowStore.getState().setDraftUpdatedAt(res.updated_at)
              setSyncWorkflowDraftHash(res.hash)
              handleGetInitialWorkflowData()
            })
          }
        })
      }
    }
  }, [appACLCapabilities.canEdit, appDetail, getWorkflowDraftGraphForCanvas, nodesTemplate, edgesTemplate, workflowStore, setSyncWorkflowDraftHash])

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
        }, {} as Record<string, unknown>),
      })
      workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
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
