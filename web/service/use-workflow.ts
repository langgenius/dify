import type {
  WorkflowPaginationResponse,
  WorkflowPublishResponse,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type {
  EnvironmentDeployment,
  GetEnvironmentDeploymentResponse,
  ListEnvironmentDeploymentsResponse,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { InfiniteData, QueryClient, UseQueryOptions } from '@tanstack/react-query'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { CommonResponse } from '@/models/common'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  WorkflowConfigResponse,
  WorkflowRunHistoryResponse,
} from '@/types/workflow'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import { del, get, patch, post } from './base'
import { appWorkflowQueryOptions, appWorkflowVersionsInfiniteQueryKey } from './workflow-queries'

const NAME_SPACE = 'workflow'

type UseAppWorkflowOptions = Pick<UseQueryOptions, 'retry'>

export const useAppWorkflow = (appID: string, options?: UseAppWorkflowOptions) => {
  return useQuery({
    ...appWorkflowQueryOptions(appID),
    ...options,
  })
}

const WorkflowRunHistoryKey = [NAME_SPACE, 'runHistory']

export const useWorkflowRunHistory = (url?: string, enabled = true) => {
  return useQuery<WorkflowRunHistoryResponse>({
    queryKey: [...WorkflowRunHistoryKey, url],
    queryFn: () => get<WorkflowRunHistoryResponse>(url as string),
    enabled: !!url && enabled,
    staleTime: 0,
  })
}

export const useInvalidateWorkflowRunHistory = () => {
  const queryClient = useQueryClient()
  return (url: string) => {
    queryClient.invalidateQueries({
      queryKey: [...WorkflowRunHistoryKey, url],
    })
  }
}

export const useInvalidateAppWorkflow = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    return queryClient.invalidateQueries({
      queryKey: appWorkflowQueryOptions(appID).queryKey,
    })
  }
}

export const useWorkflowConfig = <T = WorkflowConfigResponse>(
  url: string,
  onSuccess: (v: T) => void,
) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'config', url],
    staleTime: 0,
    queryFn: async () => {
      const data = await get<T>(url)
      onSuccess(data)
      return data
    },
  })
}

const WorkflowVersionHistoryKey = [NAME_SPACE, 'versionHistory']

export const useWorkflowVersionHistory = (params: FetchWorkflowDraftPageParams) => {
  const { url, initialPage, limit, userId, namedOnly } = params
  return useInfiniteQuery({
    enabled: !!url,
    queryKey: [...WorkflowVersionHistoryKey, url, initialPage, limit, userId, namedOnly],
    queryFn: ({ pageParam = 1 }) =>
      get<FetchWorkflowDraftPageResponse>(url, {
        params: {
          page: pageParam,
          limit,
          user_id: userId || '',
          named_only: !!namedOnly,
        },
      }),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : null),
    initialPageParam: initialPage,
  })
}

export const useResetWorkflowVersionHistory = () => {
  const queryClient = useQueryClient()

  return () =>
    Promise.all([
      queryClient.resetQueries({ queryKey: [...WorkflowVersionHistoryKey] }),
      queryClient.resetQueries({ queryKey: appWorkflowVersionsInfiniteQueryKey() }),
    ])
}

function syncWorkflowVersionMetadata(
  version: WorkflowVersion | undefined,
  updatedWorkflow: WorkflowResponse,
) {
  if (!version || version.id !== updatedWorkflow.id) return version
  if (
    version.marked_name === updatedWorkflow.marked_name &&
    version.marked_comment === updatedWorkflow.marked_comment
  )
    return version

  return {
    ...version,
    marked_name: updatedWorkflow.marked_name,
    marked_comment: updatedWorkflow.marked_comment,
  }
}

function syncEnvironmentDeploymentVersion(
  environmentDeployment: EnvironmentDeployment,
  updatedWorkflow: WorkflowResponse,
) {
  const deployment = environmentDeployment.deployment
  if (!deployment) return environmentDeployment

  const currentVersion = syncWorkflowVersionMetadata(deployment.current_version, updatedWorkflow)
  const latestOperation = deployment.latest_operation
  const targetVersion = syncWorkflowVersionMetadata(
    latestOperation?.target_version,
    updatedWorkflow,
  )
  const currentVersionChanged = currentVersion !== deployment.current_version
  const targetVersionChanged = targetVersion !== latestOperation?.target_version

  if (!currentVersionChanged && !targetVersionChanged) return environmentDeployment

  return {
    ...environmentDeployment,
    deployment: {
      ...deployment,
      current_version: currentVersion,
      latest_operation:
        latestOperation && targetVersionChanged
          ? {
              ...latestOperation,
              target_version: targetVersion,
            }
          : latestOperation,
    },
  }
}

function syncWorkflowVersionPages(
  data: InfiniteData<WorkflowPaginationResponse> | undefined,
  updatedWorkflow: WorkflowResponse,
) {
  if (!data) return data

  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((workflow) => {
      if (workflow.id !== updatedWorkflow.id) return workflow

      changed = true
      pageChanged = true
      return updatedWorkflow
    })

    return pageChanged ? { ...page, items } : page
  })

  return changed ? { ...data, pages } : data
}

function syncEnvironmentDeployments(
  data: ListEnvironmentDeploymentsResponse | undefined,
  updatedWorkflow: WorkflowResponse,
) {
  if (!data) return data

  let changed = false
  const environmentDeployments = data.environment_deployments.map((deployment) => {
    const updatedDeployment = syncEnvironmentDeploymentVersion(deployment, updatedWorkflow)
    if (updatedDeployment !== deployment) changed = true
    return updatedDeployment
  })

  return changed ? { ...data, environment_deployments: environmentDeployments } : data
}

function syncAppWorkflowVersionCaches(
  queryClient: QueryClient,
  appId: string,
  updatedWorkflow: WorkflowResponse,
) {
  const publishedWorkflowQuery = appWorkflowQueryOptions(appId)

  queryClient.setQueryData<WorkflowResponse>(publishedWorkflowQuery.queryKey, (workflow) =>
    workflow?.id === updatedWorkflow.id ? updatedWorkflow : workflow,
  )
  queryClient.setQueriesData<InfiniteData<WorkflowPaginationResponse>>(
    { queryKey: appWorkflowVersionsInfiniteQueryKey() },
    (data) => syncWorkflowVersionPages(data, updatedWorkflow),
  )
}

function syncWorkflowDeploymentCaches(
  queryClient: QueryClient,
  appId: string,
  updatedWorkflow: WorkflowResponse,
) {
  const environmentDeploymentsQuery =
    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
      },
    })

  queryClient.setQueryData<ListEnvironmentDeploymentsResponse>(
    environmentDeploymentsQuery.queryKey,
    (data) => syncEnvironmentDeployments(data, updatedWorkflow),
  )
  queryClient.setQueriesData<GetEnvironmentDeploymentResponse>(
    {
      queryKey: consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.key({
        type: 'query',
      }),
    },
    (data) => {
      if (!data) return data

      const environmentDeployment = syncEnvironmentDeploymentVersion(
        data.environment_deployment,
        updatedWorkflow,
      )
      return environmentDeployment === data.environment_deployment
        ? data
        : { ...data, environment_deployment: environmentDeployment }
    },
  )

  return environmentDeploymentsQuery.queryKey
}

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (params: UpdateWorkflowParams) =>
      patch<WorkflowResponse>(params.url, {
        body: {
          marked_name: params.title,
          marked_comment: params.releaseNotes,
        },
      }),
    onSuccess: (updatedWorkflow, params) => {
      if (params.appId) syncAppWorkflowVersionCaches(queryClient, params.appId, updatedWorkflow)

      const environmentDeploymentsQueryKey =
        params.appId && (params.appMode === 'workflow' || params.appMode === 'advanced-chat')
          ? syncWorkflowDeploymentCaches(queryClient, params.appId, updatedWorkflow)
          : undefined
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: [...WorkflowVersionHistoryKey] }),
        queryClient.invalidateQueries({ queryKey: appWorkflowVersionsInfiniteQueryKey() }),
      ]

      if (environmentDeploymentsQueryKey) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: environmentDeploymentsQueryKey }),
        )
      }

      return Promise.all(invalidations)
    },
  })
}

export const useDeleteWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (url: string) => del(url),
  })
}

export const useRestoreWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'restore'],
    mutationFn: (url: string) =>
      post<CommonResponse & { updated_at: number; hash: string }>(url, {}, { silent: true }),
  })
}

export const usePublishWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish'],
    mutationFn: (params: PublishWorkflowParams) =>
      post<WorkflowPublishResponse>(params.url, {
        body: {
          marked_name: params.title,
          marked_comment: params.releaseNotes,
        },
      }),
  })
}

function lastRunQueryOptions(resource: EditorResource, nodeId: string, enabled: boolean) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions({
        input: { params: { app_id: resource.appId, node_id: nodeId } },
        enabled,
        retry: 0,
        context: { silent: true },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
          enabled,
          retry: 0,
          context: { silent: true },
        },
      )
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.queryOptions(
        {
          input: { params: { snippet_id: resource.snippetId, node_id: nodeId } },
          enabled,
          retry: 0,
          context: { silent: true },
        },
      )
  }
}
function lastRunQueryKey(resource: EditorResource, nodeId?: string) {
  switch (resource.kind) {
    case 'app':
      return consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.key({
        type: 'query',
        input: { params: { app_id: resource.appId, ...(nodeId ? { node_id: nodeId } : {}) } },
      })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.key(
        {
          type: 'query',
          input: {
            params: { pipeline_id: resource.pipelineId, ...(nodeId ? { node_id: nodeId } : {}) },
          },
        },
      )
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.key({
        type: 'query',
        input: {
          params: { snippet_id: resource.snippetId, ...(nodeId ? { node_id: nodeId } : {}) },
        },
      })
  }
}
export const useLastRun = (resource: EditorResource, nodeId: string, enabled: boolean) =>
  useQuery(lastRunQueryOptions(resource, nodeId, enabled))

export const useInvalidateLastRun = (resource: EditorResource, nodeId: string) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource, nodeId) })
}

export const useInvalidateAllLastRun = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource) })
}

export const useConversationVarValues = (resource: EditorResource | undefined) => {
  return useQuery(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryOptions({
      input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
      select: (response) => response.items,
    }),
  )
}

export const useInvalidateConversationVarValues = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () =>
    resource.kind === 'app'
      ? queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({
            input: { params: { app_id: resource.appId } },
          }),
        })
      : Promise.resolve()
}

export const useResetInspectorVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (varId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.reset.put({
            params: { app_id: resource.appId, variable_id: varId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.reset.put(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.reset.put(
            { params: { snippet_id: resource.snippetId, variable_id: varId } },
          )
      }
    },
  })
}

export const useSysVarValues = (resource: EditorResource | undefined) => {
  return useQuery(
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryOptions({
      input: resource?.kind === 'app' ? { params: { app_id: resource.appId } } : skipToken,
      select: (response) => response.items,
    }),
  )
}

export const useInvalidateSysVarValues = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () =>
    resource.kind === 'app'
      ? queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryKey({
            input: { params: { app_id: resource.appId } },
          }),
        })
      : Promise.resolve()
}

export const useDeleteAllInspectorVars = (resource: EditorResource) => {
  return useMutation({
    mutationFn: () => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.delete({
            params: { app_id: resource.appId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.delete({
            params: { pipeline_id: resource.pipelineId },
          })
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.delete({
            params: { snippet_id: resource.snippetId },
          })
      }
    },
  })
}

export const useDeleteNodeInspectorVars = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (nodeId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.variables.delete({
            params: { app_id: resource.appId, node_id: nodeId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.variables.delete(
            { params: { pipeline_id: resource.pipelineId, node_id: nodeId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.nodes.byNodeId.variables.delete(
            { params: { snippet_id: resource.snippetId, node_id: nodeId } },
          )
      }
    },
  })
}

export const useDeleteInspectVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: (varId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.delete({
            params: { app_id: resource.appId, variable_id: varId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.delete(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.delete({
            params: { snippet_id: resource.snippetId, variable_id: varId },
          })
      }
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (resource: EditorResource) => {
  return useMutation({
    mutationFn: ({ varId, ...body }: { varId: string; name?: string; value?: unknown }) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.draft.variables.byVariableId.patch({
            params: { app_id: resource.appId, variable_id: varId },
            body,
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.draft.variables.byVariableId.patch(
            { params: { pipeline_id: resource.pipelineId, variable_id: varId }, body },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.draft.variables.byVariableId.patch({
            params: { snippet_id: resource.snippetId, variable_id: varId },
            body,
          })
      }
    },
  })
}

export const useTestEmailSender = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'test email sender'],
    mutationFn: async (data: {
      appID: string
      nodeID: string
      deliveryID: string
      inputs: Record<string, any>
    }) => {
      const { appID, nodeID, deliveryID, inputs } = data
      return post<CommonResponse>(
        `/apps/${appID}/workflows/draft/human-input/nodes/${nodeID}/delivery-test`,
        {
          body: {
            delivery_method_id: deliveryID,
            inputs,
          },
        },
      )
    },
  })
}
