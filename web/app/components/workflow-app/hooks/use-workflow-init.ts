import type { Edge, Node } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useWorkflowConfig } from '@/service/use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import {
  appWorkflowDefaultBlockConfigsQueryOptions,
  appWorkflowDraftQueryOptions,
  appWorkflowQueryOptions,
} from '@/service/workflow-queries'
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
    .filter((node) => node?.data?.type === BlockEnum.Start)
    .map((node) => node.id)

  if (!startNodeIds.length) return false

  return edges.some((edge) => startNodeIds.includes(edge.source))
}

const isNodeDefaultConfig = (
  block: Record<string, unknown>,
): block is { type: string; config: Record<string, unknown> } => {
  return (
    typeof block.type === 'string' &&
    typeof block.config === 'object' &&
    block.config !== null &&
    !Array.isArray(block.config)
  )
}

type LocalWorkflowDraft = {
  appId: string
  draft: FetchWorkflowDraftResponse
}

const getWorkflowDraftErrorCode = async (error: object) => {
  if (!('json' in error) || typeof error.json !== 'function') return undefined
  if ('bodyUsed' in error && error.bodyUsed) return undefined

  const body = (await error.json()) as { code?: string }
  return body.code
}

export const useWorkflowInit = () => {
  const workflowStore = useWorkflowStore()
  const workflowTemplate = useWorkflowTemplate()
  const [initialWorkflowTemplate] = useState(workflowTemplate)
  const { nodes: nodesTemplate, edges: edgesTemplate } = initialWorkflowTemplate
  const appDetail = useAppStore((state) => state.appDetail)!
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)
  const setSyncWorkflowDraftHash = useStore((s) => s.setSyncWorkflowDraftHash)
  const {
    data: serverDraft,
    error: draftError,
    refetch: refetchDraft,
  } = useQuery(appWorkflowDraftQueryOptions(appDetail.id))
  const { data: nodesDefaultConfigsData, error: nodesDefaultConfigsError } = useQuery(
    appWorkflowDefaultBlockConfigsQueryOptions(appDetail.id),
  )
  const { data: publishedWorkflow, error: publishedWorkflowError } = useQuery(
    appWorkflowQueryOptions(appDetail.id),
  )
  const [localDraftState, setLocalDraftState] = useState<LocalWorkflowDraft>()
  const handledDraftErrorsRef = useRef(new WeakSet<object>())
  const localDraft = localDraftState?.appId === appDetail.id ? localDraftState.draft : undefined
  const sourceDraft = serverDraft ?? localDraft
  const data = useMemo(() => {
    if (!sourceDraft) return undefined

    return {
      ...sourceDraft,
      graph: getWorkflowDraftGraphForCanvas(sourceDraft.graph, {
        localStartPlaceholderNodes: nodesTemplate,
      }),
    }
  }, [getWorkflowDraftGraphForCanvas, nodesTemplate, sourceDraft])

  useEffect(() => {
    workflowStore.setState({ appId: appDetail.id, appName: appDetail.name })
  }, [appDetail.id, appDetail.name, workflowStore])

  const handleUpdateWorkflowFileUploadConfig = useCallback(
    (config: FileUploadConfigResponse) => {
      const { setFileUploadConfig } = workflowStore.getState()
      setFileUploadConfig(config)
    },
    [workflowStore],
  )
  const { data: fileUploadConfigResponse, isLoading: isFileUploadConfigLoading } =
    useWorkflowConfig('/files/upload', handleUpdateWorkflowFileUploadConfig)

  const handleDraftError = useCallback(
    async (error: object) => {
      const errorCode = await getWorkflowDraftErrorCode(error)
      if (errorCode !== 'draft_workflow_not_exist') return

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
        setLocalDraftState({
          appId: appDetail.id,
          draft: createLocalWorkflowDraft(initialGraph),
        })
        return
      }

      const response = await syncWorkflowDraft({
        url: `/apps/${appDetail.id}/workflows/draft`,
        params: {
          graph: initialGraph,
          features: {
            retriever_resource: { enabled: true },
          },
          conversation_variables: [],
        },
      })
      workflowStore.getState().setDraftUpdatedAt(response.updated_at)
      setSyncWorkflowDraftHash(response.hash)
      await refetchDraft()
    },
    [
      appACLCapabilities.canEdit,
      appDetail.id,
      appDetail.mode,
      edgesTemplate,
      nodesTemplate,
      refetchDraft,
      setSyncWorkflowDraftHash,
      workflowStore,
    ],
  )

  useEffect(() => {
    if (typeof draftError !== 'object' || draftError === null) return
    if (handledDraftErrorsRef.current.has(draftError)) return

    handledDraftErrorsRef.current.add(draftError)
    void handleDraftError(draftError).catch(console.error)
  }, [draftError, handleDraftError])

  useEffect(() => {
    if (!data) return

    workflowStore.setState({
      envSecrets: (data.environment_variables || [])
        .filter((env) => env.value_type === 'secret')
        .reduce(
          (acc, env) => {
            if (typeof env.value === 'string') acc[env.id] = env.value
            return acc
          },
          {} as Record<string, string>,
        ),
      environmentVariables:
        data.environment_variables?.map((env) =>
          env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
        ) || [],
      conversationVariables: data.conversation_variables || [],
      isWorkflowDataLoaded: true,
    })
    setSyncWorkflowDraftHash(data.hash)
    workflowStore.getState().setDraftUpdatedAt(data.updated_at)
    workflowStore.getState().setToolPublished(data.tool_published)
  }, [data, setSyncWorkflowDraftHash, workflowStore])

  useEffect(() => {
    if (!nodesDefaultConfigsData) return

    workflowStore.setState({
      nodesDefaultConfigs: nodesDefaultConfigsData.filter(isNodeDefaultConfig).reduce(
        (acc, block) => {
          if (!acc[block.type]) acc[block.type] = { ...block.config }
          return acc
        },
        {} as Record<string, unknown>,
      ),
    })
  }, [nodesDefaultConfigsData, workflowStore])

  useEffect(() => {
    if (nodesDefaultConfigsError) console.error(nodesDefaultConfigsError)
  }, [nodesDefaultConfigsError])

  useEffect(() => {
    if (publishedWorkflow === undefined) return

    workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
    const graph = publishedWorkflow?.graph
    const nodes = Array.isArray(graph?.nodes) ? (graph.nodes as Node[]) : undefined
    const edges = Array.isArray(graph?.edges) ? (graph.edges as Edge[]) : undefined
    workflowStore.getState().setLastPublishedHasUserInput(hasConnectedUserInput(nodes, edges))
  }, [publishedWorkflow, workflowStore])

  useEffect(() => {
    if (!publishedWorkflowError) return

    console.error(publishedWorkflowError)
    workflowStore.getState().setLastPublishedHasUserInput(false)
  }, [publishedWorkflowError, workflowStore])

  return {
    data,
    isLoading: !data || isFileUploadConfigLoading,
    fileUploadConfigResponse,
  }
}
