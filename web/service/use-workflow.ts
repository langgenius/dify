import type {
  AppMode,
  WorkflowPaginationResponse,
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
import type { HistoryWorkflowData } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftPageResponse, PublishWorkflowParams } from '@/types/workflow'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toWorkflowDraft } from '@/app/components/workflow/utils/workflow-response'
import { consoleClient, consoleQuery } from '@/service/console'
import { appWorkflowQueryOptions, appWorkflowVersionsInfiniteQueryKey } from './workflow-queries'

const NAME_SPACE = 'workflow'

type UseAppWorkflowOptions = Pick<UseQueryOptions, 'retry'>

export const useAppWorkflow = (appID: string, options?: UseAppWorkflowOptions) => {
  return useQuery({
    ...appWorkflowQueryOptions(appID),
    ...options,
  })
}

export type WorkflowRunHistoryItem = HistoryWorkflowData & {
  created_at: number
  created_by_name?: string
}

type WorkflowRunListItem = {
  id: string
  status?: string | null
  conversation_id?: string | null
  created_at?: number | null
  finished_at?: number | null
  created_by_account?: { name: string } | null
}

const toWorkflowRunHistory = (response: { data: WorkflowRunListItem[] }) =>
  response.data.map((run): WorkflowRunHistoryItem => ({
    id: run.id,
    status: run.status ?? '',
    conversation_id: run.conversation_id ?? undefined,
    created_at: run.created_at ?? 0,
    finished_at: run.finished_at ?? undefined,
    created_by_name: run.created_by_account?.name,
  }))

function workflowRunHistoryQueryOptions(resource: EditorResource, enabled: boolean) {
  const options = { enabled, staleTime: 0, select: toWorkflowRunHistory }
  switch (resource.kind) {
    case 'app':
      return resource.mode === 'advanced-chat'
        ? consoleQuery.apps.byAppId.advancedChat.workflowRuns.get.queryOptions({
            input: { params: { app_id: resource.appId } },
            ...options,
          })
        : consoleQuery.apps.byAppId.workflowRuns.get.queryOptions({
            input: { params: { app_id: resource.appId } },
            ...options,
          })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflowRuns.get.queryOptions({
        input: { params: { pipeline_id: resource.pipelineId } },
        ...options,
      })
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflowRuns.get.queryOptions({
        input: { params: { snippet_id: resource.snippetId } },
        ...options,
      })
  }
}

function workflowRunHistoryQueryKey(resource: EditorResource) {
  switch (resource.kind) {
    case 'app':
      return resource.mode === 'advanced-chat'
        ? consoleQuery.apps.byAppId.advancedChat.workflowRuns.get.key({
            input: { params: { app_id: resource.appId } },
          })
        : consoleQuery.apps.byAppId.workflowRuns.get.key({
            input: { params: { app_id: resource.appId } },
          })
    case 'knowledge-pipeline':
      return consoleQuery.rag.pipelines.byPipelineId.workflowRuns.get.key({
        input: { params: { pipeline_id: resource.pipelineId } },
      })
    case 'snippet':
      return consoleQuery.snippets.bySnippetId.workflowRuns.get.key({
        input: { params: { snippet_id: resource.snippetId } },
      })
  }
}

export const useWorkflowRunHistory = (resource: EditorResource, enabled = true) =>
  useQuery(workflowRunHistoryQueryOptions(resource, enabled))

export const useInvalidateWorkflowRunHistory = (resource: EditorResource) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: workflowRunHistoryQueryKey(resource) })
}

export const useInvalidateAppWorkflow = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    return queryClient.invalidateQueries({
      queryKey: appWorkflowQueryOptions(appID).queryKey,
    })
  }
}

const WorkflowVersionHistoryKey = [NAME_SPACE, 'versionHistory']

type WorkflowVersionHistoryParams = {
  owner: WorkflowVersionOwner
  initialPage: number
  limit: number
  userId?: string
  namedOnly?: boolean
}

const fetchWorkflowVersionPage = async (
  { owner, limit, userId, namedOnly }: WorkflowVersionHistoryParams,
  page: number,
): Promise<FetchWorkflowDraftPageResponse> => {
  const query = { page, limit, user_id: userId || '', named_only: !!namedOnly }
  const response =
    owner.kind === 'app'
      ? await consoleClient.apps.byAppId.workflows.get({ params: { app_id: owner.appId }, query })
      : owner.kind === 'knowledge-pipeline'
        ? await consoleClient.rag.pipelines.byPipelineId.workflows.get({
            params: { pipeline_id: owner.pipelineId },
            query,
          })
        : // Snippet versions cannot be filtered by author or name.
          await consoleClient.snippets.bySnippetId.workflows.get({
            params: { snippet_id: owner.snippetId },
            query: { page, limit },
          })
  return {
    items: response.items.map(toWorkflowDraft),
    has_more: response.has_more,
    page: response.page,
  }
}

export const useWorkflowVersionHistory = (params: WorkflowVersionHistoryParams) => {
  const { owner, initialPage, limit, userId, namedOnly } = params
  return useInfiniteQuery({
    queryKey: [...WorkflowVersionHistoryKey, owner, initialPage, limit, userId, namedOnly],
    queryFn: ({ pageParam }) =>
      fetchWorkflowVersionPage({ owner, initialPage, limit, userId, namedOnly }, pageParam),
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

// Version mutations only need the owner's id; app callers outside the editor may not know a
// workflow-only mode, so `mode` stays optional here.
export type WorkflowVersionOwner =
  | Readonly<{ kind: 'app'; appId: string; mode?: AppMode }>
  | Readonly<{ kind: 'knowledge-pipeline'; pipelineId: string }>
  | Readonly<{ kind: 'snippet'; snippetId: string }>

export type UpdateWorkflowParams = {
  owner: WorkflowVersionOwner
  workflowId: string
  title: string
  releaseNotes: string
}

const updateWorkflowVersion = async ({
  owner,
  workflowId,
  title,
  releaseNotes,
}: UpdateWorkflowParams) => {
  const body = { marked_name: title, marked_comment: releaseNotes }
  switch (owner.kind) {
    case 'app':
      return {
        owner,
        workflow: await consoleClient.apps.byAppId.workflows.byWorkflowId.patch({
          params: { app_id: owner.appId, workflow_id: workflowId },
          body,
        }),
      }
    case 'knowledge-pipeline':
      return {
        owner,
        workflow: await consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.patch({
          params: { pipeline_id: owner.pipelineId, workflow_id: workflowId },
          body,
        }),
      }
    case 'snippet':
      return {
        owner,
        workflow: await consoleClient.snippets.bySnippetId.workflows.byWorkflowId.patch({
          params: { snippet_id: owner.snippetId, workflow_id: workflowId },
          body,
        }),
      }
  }
}

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: updateWorkflowVersion,
    onSuccess: (result) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: [...WorkflowVersionHistoryKey] }),
        queryClient.invalidateQueries({ queryKey: appWorkflowVersionsInfiniteQueryKey() }),
      ]

      if (result.owner.kind === 'app') {
        const { appId, mode } = result.owner
        syncAppWorkflowVersionCaches(queryClient, appId, result.workflow)
        if (mode === 'workflow' || mode === 'advanced-chat') {
          const environmentDeploymentsQueryKey = syncWorkflowDeploymentCaches(
            queryClient,
            appId,
            result.workflow,
          )
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: environmentDeploymentsQueryKey }),
          )
        }
      }

      return Promise.all(invalidations)
    },
  })
}

export const useDeleteWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: ({ owner, workflowId }: { owner: WorkflowVersionOwner; workflowId: string }) => {
      switch (owner.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.byWorkflowId.delete({
            params: { app_id: owner.appId, workflow_id: workflowId },
          })
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.delete({
            params: { pipeline_id: owner.pipelineId, workflow_id: workflowId },
          })
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.byWorkflowId.delete({
            params: { snippet_id: owner.snippetId, workflow_id: workflowId },
          })
      }
    },
  })
}

export const useRestoreWorkflow = (resource: EditorResource) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'restore'],
    mutationFn: (versionId: string) => {
      switch (resource.kind) {
        case 'app':
          return consoleClient.apps.byAppId.workflows.byWorkflowId.restore.post(
            { params: { app_id: resource.appId, workflow_id: versionId } },
            { context: { silent: true } },
          )
        case 'knowledge-pipeline':
          return consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.restore.post(
            { params: { pipeline_id: resource.pipelineId, workflow_id: versionId } },
            { context: { silent: true } },
          )
        case 'snippet':
          return consoleClient.snippets.bySnippetId.workflows.byWorkflowId.restore.post(
            { params: { snippet_id: resource.snippetId, workflow_id: versionId } },
            { context: { silent: true } },
          )
      }
    },
  })
}

export const usePublishAppWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish'],
    mutationFn: ({ appId, title, releaseNotes }: PublishWorkflowParams & { appId: string }) =>
      consoleClient.apps.byAppId.workflows.publish.post({
        params: { app_id: appId },
        body: {
          marked_name: title,
          marked_comment: releaseNotes,
        },
      }),
  })
}

export const usePublishPipelineWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish'],
    mutationFn: (pipelineId: string) =>
      consoleClient.rag.pipelines.byPipelineId.workflows.publish.post({
        params: { pipeline_id: pipelineId },
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
      return consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.deliveryTest.post(
        {
          params: { app_id: appID, node_id: nodeID },
          body: { delivery_method_id: deliveryID, inputs },
        },
      )
    },
  })
}
