import type { RefObject } from 'react'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowDraftGraphForCanvas } from '@/app/components/workflow/hooks/use-workflow-draft-graph-for-canvas'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { isWorkflowDraftReplacedEvent } from '@/app/components/workflow/workflow-data-update-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useWorkflowConfig } from '@/service/use-workflow'
import {
  fetchAppWorkflowDraft,
  fetchNodesDefaultConfigs,
  syncWorkflowDraft,
} from '@/service/workflow'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { useWorkflowTemplate } from './use-workflow-template'

const emptyAccount = {
  id: '',
  name: '',
  email: '',
}

const createLocalWorkflowDraft = (
  graph: FetchAppWorkflowDraftResponse['graph'],
): FetchAppWorkflowDraftResponse => ({
  id: '',
  graph,
  features: {
    retriever_resource: { enabled: true },
  },
  created_at: 0,
  created_by: emptyAccount,
  hash: '',
  last_replacement_id: null,
  updated_at: 0,
  updated_by: emptyAccount,
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  rag_pipeline_variables: [],
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

const isDraftWorkflowNotFoundError = async (error: unknown): Promise<boolean> => {
  if (!(error instanceof Response) || error.status !== 404) return false

  try {
    const body: unknown = await error.clone().json()
    return (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'draft_workflow_not_exist'
    )
  } catch {
    return false
  }
}

export const useWorkflowInit = (canvasReadyRef: RefObject<boolean>) => {
  const queryClient = useQueryClient()
  const workflowStore = useWorkflowStore()
  const appId = useStore((state) => state.appId)
  const { nodes: nodesTemplate, edges: edgesTemplate } = useWorkflowTemplate()
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
  const setLastAppliedReplacementId = useStore((s) => s.setLastAppliedReplacementId)
  const [data, setData] = useState<FetchAppWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  const [initializationError, setInitializationError] = useState<Error>()
  const [canvasInitEpoch, setCanvasInitEpoch] = useState(0)
  const requestGenerationRef = useRef(0)
  const { eventEmitter } = useEventEmitterContextContext()
  useEffect(() => {
    workflowStore.setState({ appName: appDetail.name })
  }, [appDetail.name, workflowStore])

  const handleUpdateWorkflowFileUploadConfig = useCallback(
    (config: FileUploadConfigResponse) => {
      const { setFileUploadConfig } = workflowStore.getState()
      setFileUploadConfig(config)
    },
    [workflowStore],
  )
  const { data: fileUploadConfigResponse, isLoading: isFileUploadConfigLoading } =
    useWorkflowConfig('/files/upload', handleUpdateWorkflowFileUploadConfig)

  const hydrateInitialWorkflowData = useCallback(
    (draft: FetchAppWorkflowDraftResponse) => {
      const initialData = {
        ...draft,
        graph: {
          ...getWorkflowDraftGraphForCanvas(draft.graph, {
            localStartPlaceholderNodes: nodesTemplate,
          }),
          // Let the canvas fit the nodes when no saved viewport exists.
          viewport: draft.graph.viewport,
        },
      }

      setData(initialData)
      workflowStore.setState({
        envSecrets: (initialData.environment_variables || [])
          .filter((env) => env.value_type === 'secret')
          .reduce(
            (acc, env) => {
              if (typeof env.value === 'string') acc[env.id] = env.value
              return acc
            },
            {} as Record<string, string>,
          ),
        environmentVariables:
          initialData.environment_variables?.map((env) =>
            env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
          ) || [],
        conversationVariables: initialData.conversation_variables || [],
        isWorkflowDataLoaded: true,
      })
      setSyncWorkflowDraftHash(initialData.hash)
      setLastAppliedReplacementId(initialData.last_replacement_id)
      workflowStore.getState().advanceDraftReplacementEpoch()
      setInitializationError(undefined)
      setIsLoading(false)
    },
    [
      getWorkflowDraftGraphForCanvas,
      nodesTemplate,
      workflowStore,
      setSyncWorkflowDraftHash,
      setLastAppliedReplacementId,
    ],
  )

  const handleGetInitialWorkflowData = useCallback(async () => {
    if (!appId) return
    const requestGeneration = ++requestGenerationRef.current
    try {
      const res = await fetchAppWorkflowDraft(appId)
      if (requestGeneration !== requestGenerationRef.current) return
      hydrateInitialWorkflowData(res)
    } catch (error: unknown) {
      if (requestGeneration !== requestGenerationRef.current) return
      const draftNotFound = await isDraftWorkflowNotFoundError(error)
      if (requestGeneration !== requestGenerationRef.current) return
      if (!appDetail || !draftNotFound) {
        setInitializationError(
          error instanceof Error ? error : new Error('Failed to load the workflow draft.'),
        )
        return
      }

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
          viewport: undefined,
        })
        setData(initialData)
        workflowStore.setState({
          envSecrets: {},
          environmentVariables: [],
          conversationVariables: [],
          isWorkflowDataLoaded: true,
        })
        setSyncWorkflowDraftHash(initialData.hash)
        setLastAppliedReplacementId(initialData.last_replacement_id)
        setIsLoading(false)
        return
      }

      syncWorkflowDraft({
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: initialGraph,
          features: {
            retriever_resource: { enabled: true },
          },
          conversation_variables: [],
        },
      })
        .then((res) => {
          if (requestGeneration !== requestGenerationRef.current) return
          workflowStore.getState().setDraftUpdatedAt(res.updated_at)
          setSyncWorkflowDraftHash(res.hash)
          void handleGetInitialWorkflowData()
        })
        .catch((error: unknown) => {
          if (requestGeneration !== requestGenerationRef.current) return
          if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
            workflowStore.setState({ notInitialWorkflow: false })
            void handleGetInitialWorkflowData()
            return
          }
          setInitializationError(
            error instanceof Error ? error : new Error('Failed to create the workflow draft.'),
          )
        })
    }
  }, [
    appId,
    appACLCapabilities.canEdit,
    appDetail,
    getWorkflowDraftGraphForCanvas,
    hydrateInitialWorkflowData,
    nodesTemplate,
    edgesTemplate,
    workflowStore,
    setSyncWorkflowDraftHash,
    setLastAppliedReplacementId,
  ])

  const loadInitialWorkflowData = useEffectEvent(handleGetInitialWorkflowData)
  useEffect(() => {
    const requestGeneration = requestGenerationRef
    void loadInitialWorkflowData()
    return () => {
      requestGeneration.current++
    }
  }, [])

  eventEmitter?.useSubscription((event) => {
    if (!isWorkflowDraftReplacedEvent(event)) return
    if (event.payload.appId !== appId || canvasReadyRef.current) return

    requestGenerationRef.current++
    hydrateInitialWorkflowData(event.payload.draft)
    setCanvasInitEpoch((epoch) => epoch + 1)
  })

  const handleFetchPreloadData = useCallback(async () => {
    if (!appId) return
    const [nodesDefaultConfigsResult, publishedWorkflowResult] = await Promise.allSettled([
      fetchNodesDefaultConfigs(`/apps/${appId}/workflows/default-workflow-block-configs`),
      queryClient.query(appWorkflowQueryOptions(appId)),
    ])

    if (nodesDefaultConfigsResult.status === 'fulfilled') {
      const nodesDefaultConfigsData = nodesDefaultConfigsResult.value
      workflowStore.setState({
        nodesDefaultConfigs: nodesDefaultConfigsData.reduce(
          (acc, block) => {
            if (!acc[block.type]) acc[block.type] = { ...block.config }
            return acc
          },
          {} as Record<string, unknown>,
        ),
      })
    } else {
      console.error(nodesDefaultConfigsResult.reason)
    }

    if (publishedWorkflowResult.status === 'fulfilled') {
      const publishedWorkflow = publishedWorkflowResult.value
      workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
      const graph = publishedWorkflow?.graph
      const nodes = Array.isArray(graph?.nodes) ? (graph.nodes as Node[]) : undefined
      const edges = Array.isArray(graph?.edges) ? (graph.edges as Edge[]) : undefined
      workflowStore.getState().setLastPublishedHasUserInput(hasConnectedUserInput(nodes, edges))
    } else {
      console.error(publishedWorkflowResult.reason)
      workflowStore.getState().setLastPublishedHasUserInput(false)
    }
  }, [workflowStore, appId, queryClient])

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
    canvasInitEpoch,
    initializationError,
  }
}
