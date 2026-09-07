import type {
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
import type { CommonResponse } from '@/models/common'
import type { FlowType } from '@/types/common'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  NodeTracing,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  VarInInspect,
  WorkflowConfigResponse,
  WorkflowRunHistoryResponse,
} from '@/types/workflow'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppModeEnum } from '@/types/app'
import { del, get, patch, post, put } from './base'
import { consoleQuery } from './client'
import { useInvalid } from './use-base'
import { getFlowPrefix } from './utils'
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
        params.appId &&
        (params.appMode === AppModeEnum.WORKFLOW || params.appMode === AppModeEnum.ADVANCED_CHAT)
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
      post<CommonResponse & { created_at: number }>(params.url, {
        body: {
          marked_name: params.title,
          marked_comment: params.releaseNotes,
        },
      }),
  })
}

const useLastRunKey = [NAME_SPACE, 'last-run']
export const useLastRun = (
  flowType: FlowType,
  flowId: string,
  nodeId: string,
  enabled: boolean,
) => {
  return useQuery<NodeTracing>({
    enabled,
    queryKey: [...useLastRunKey, flowType, flowId, nodeId],
    queryFn: async () => {
      return get(
        `${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/last-run`,
        {},
        {
          silent: true,
        },
      )
    },
    retry: 0,
  })
}

export const useInvalidLastRun = (flowType: FlowType, flowId: string, nodeId: string) => {
  return useInvalid([...useLastRunKey, flowType, flowId, nodeId])
}

// Rerun workflow or change the version of workflow
export const useInvalidAllLastRun = (flowType?: FlowType, flowId?: string) => {
  return useInvalid([...useLastRunKey, flowType, flowId])
}

export const useConversationVarValues = (flowType?: FlowType, flowId?: string) => {
  return useQuery({
    enabled: !!flowId,
    queryKey: [NAME_SPACE, flowType, 'conversation var values', flowId],
    queryFn: async () => {
      const { items } = (await get(
        `${getFlowPrefix(flowType)}/${flowId}/workflows/draft/conversation-variables`,
      )) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateConversationVarValues = (flowType: FlowType, flowId: string) => {
  return useInvalid([NAME_SPACE, flowType, 'conversation var values', flowId])
}

export const useResetConversationVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'reset conversation var', flowId],
    mutationFn: async (varId: string) => {
      return put(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useResetToLastRunValue = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'reset to last run value', flowId],
    mutationFn: async (varId: string): Promise<{ value: any }> => {
      return put(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useSysVarValues = (flowType?: FlowType, flowId?: string) => {
  return useQuery({
    enabled: !!flowId,
    queryKey: [NAME_SPACE, flowType, 'sys var values', flowId],
    queryFn: async () => {
      const { items } = (await get(
        `${getFlowPrefix(flowType)}/${flowId}/workflows/draft/system-variables`,
      )) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateSysVarValues = (flowType: FlowType, flowId: string) => {
  return useInvalid([NAME_SPACE, flowType, 'sys var values', flowId])
}

export const useDeleteAllInspectorVars = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete all inspector vars', flowId],
    mutationFn: async () => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables`)
    },
  })
}

export const useDeleteNodeInspectorVars = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete node inspector vars', flowId],
    mutationFn: async (nodeId: string) => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/variables`)
    },
  })
}

export const useDeleteInspectVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete inspector var', flowId],
    mutationFn: async (varId: string) => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`)
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'edit inspector var', flowId],
    mutationFn: async ({ varId, ...rest }: { varId: string; name?: string; value?: any }) => {
      return patch(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`, {
        body: rest,
      })
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
