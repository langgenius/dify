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
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from './index'

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
      // Merge so fields the list response carries beyond the PATCH response survive, such as
      // the `environments` the enterprise gateway adds to the app version list.
      return { ...workflow, ...updatedWorkflow }
    })

    return pageChanged ? { ...page, items } : page
  })

  return changed ? { ...data, pages } : data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// oRPC keys are `[path, { type, input }]`; the list filters live in `input.query`.
function isNamedOnlyVersionList(queryKey: QueryKey) {
  const options = queryKey[1]
  if (!isRecord(options) || !isRecord(options.input)) return false
  const query = options.input.query
  return isRecord(query) && query.named_only === true
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
  const versionListKey = consoleQuery.apps.byAppId.workflows.get.key({
    type: 'infinite',
    input: { params: { app_id: appId } },
  })
  // A version whose name was cleared no longer belongs in a named-only list. Reset those lists
  // so they reload from the first page instead of keeping it if the follow-up refresh fails.
  const nameCleared = !updatedWorkflow.marked_name
  queryClient.setQueriesData<InfiniteData<WorkflowPaginationResponse>>(
    {
      queryKey: versionListKey,
      predicate: (query) => !(nameCleared && isNamedOnlyVersionList(query.queryKey)),
    },
    (data) => syncWorkflowVersionPages(data, updatedWorkflow),
  )
  if (nameCleared) {
    void queryClient.resetQueries({
      queryKey: versionListKey,
      predicate: (query) => isNamedOnlyVersionList(query.queryKey),
    })
  }
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
