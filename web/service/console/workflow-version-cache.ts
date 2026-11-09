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
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from './index'

// Transitional key until the editor version list uses generated query options.
export const legacyWorkflowVersionHistoryKey = ['workflow', 'versionHistory'] as const

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

export function syncAppWorkflowVersionCaches(
  queryClient: QueryClient,
  consoleQuery: RouterUtils<ConsoleClient>,
  appId: string,
  updatedWorkflow: WorkflowResponse,
) {
  const publishedWorkflowQuery = consoleQuery.apps.byAppId.workflows.publish.get.queryOptions({
    input: { params: { app_id: appId } },
  })

  queryClient.setQueryData<WorkflowResponse>(publishedWorkflowQuery.queryKey, (workflow) =>
    workflow?.id === updatedWorkflow.id ? updatedWorkflow : workflow,
  )
  queryClient.setQueriesData<InfiniteData<WorkflowPaginationResponse>>(
    {
      queryKey: consoleQuery.apps.byAppId.workflows.get.key({
        type: 'infinite',
        input: { params: { app_id: appId } },
      }),
    },
    (data) => syncWorkflowVersionPages(data, updatedWorkflow),
  )
}

export function syncWorkflowDeploymentCaches(
  queryClient: QueryClient,
  consoleQuery: RouterUtils<ConsoleClient>,
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
        input: { params: { app_id: appId } },
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
