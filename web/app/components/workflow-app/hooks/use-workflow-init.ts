import type { Edge, Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { ORPCError } from '@orpc/client'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleClient, consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
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

export const useWorkflowInit = () => {
  const queryClient = useQueryClient()
  const workflowStore = useWorkflowStore()
  const { nodes: nodesTemplate, edges: edgesTemplate } = useWorkflowTemplate()
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
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
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)

  const { data: fileUploadConfigResponse, isLoading: isFileUploadConfigLoading } = useQuery(
    consoleQuery.files.upload.get.queryOptions({ staleTime: 0 }),
  )
  useEffect(() => {
    if (!fileUploadConfigResponse) return
    workflowStore.getState().setFileUploadConfig(fileUploadConfigResponse)
  }, [fileUploadConfigResponse, workflowStore])

  const handleGetInitialWorkflowData = useCallback(async () => {
    try {
      const res = await fetchWorkflowDraft(`/apps/${appDetail.id}/workflows/draft`)
      const initialData = {
        ...res,
        graph: {
          ...getWorkflowDraftGraphForCanvas(res.graph, {
            localStartPlaceholderNodes: nodesTemplate,
          }),
          // Let the canvas fit the nodes when no saved viewport exists.
          viewport: res.graph.viewport,
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
      setIsLoading(false)
    } catch (error: unknown) {
      if (error instanceof ORPCError) {
        if (error.code === 'draft_workflow_not_exist') {
          const isAdvancedChat = appDetail.mode === 'advanced-chat'
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
            setIsLoading(false)
            return
          }

          consoleClient.apps.byAppId.workflows.draft
            .post(
              {
                params: { app_id: appDetail.id },
                body: {
                  graph: initialGraph,
                  force: true,
                  features: {
                    retriever_resource: { enabled: true },
                  },
                  conversation_variables: [],
                },
              },
              { context: { silent: true } },
            )
            .then((res) => {
              workflowStore.getState().setDraftUpdatedAt(res.updated_at)
              setSyncWorkflowDraftHash(res.hash)
              handleGetInitialWorkflowData()
            })
        }
      }
    }
  }, [
    appACLCapabilities.canEdit,
    appDetail,
    getWorkflowDraftGraphForCanvas,
    nodesTemplate,
    edgesTemplate,
    workflowStore,
    setSyncWorkflowDraftHash,
  ])

  useEffect(() => {
    handleGetInitialWorkflowData()
  }, [])

  const handleFetchPreloadData = useCallback(async () => {
    const [nodesDefaultConfigsResult, publishedWorkflowResult] = await Promise.allSettled([
      queryClient.query(
        consoleQuery.apps.byAppId.workflows.defaultWorkflowBlockConfigs.get.queryOptions({
          input: { params: { app_id: appDetail.id } },
          staleTime: 0,
        }),
      ),
      queryClient.query(appWorkflowQueryOptions(appDetail.id)),
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
  }, [workflowStore, appDetail, queryClient])

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
