'use client'

import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type {
  EnvironmentDeployment,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from './version'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { consoleQuery } from '@/service/client'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000
const WORKFLOW_VERSIONS_PAGE_SIZE = 10

export type EnvironmentDeploymentActionKind =
  | 'changeVersion'
  | 'deployLatest'
  | 'redeploy'
  | 'retry'
  | 'undeploy'

export type EnvironmentDeploymentAction = {
  disabled: boolean
  kind: EnvironmentDeploymentActionKind
}

const appDeployAppIdAtom = atom<string | null>(null)

export function AppDeployStateBoundary({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  useHydrateAtoms([[appDeployAppIdAtom, appId]] as const, {
    dangerouslyForceHydrate: true,
  })

  return children
}

function toDeploymentVersion(
  workflow: WorkflowResponse,
  latestWorkflowId?: string,
): DeploymentVersion {
  return {
    description: workflow.marked_comment || undefined,
    id: workflow.id,
    latest: workflow.id === latestWorkflowId,
    name: workflow.marked_name || workflow.version,
    publishedAt: workflow.created_at * 1000,
    publishedBy: workflow.created_by?.name,
  }
}

const latestPublishedWorkflowQueryAtom = atomWithQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.apps.byAppId.workflows.publish.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  })
})

const latestPublishedWorkflowAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.data,
)

export const latestAppWorkflowVersionAtom = atom((get) => {
  const workflow = get(latestPublishedWorkflowAtom)
  if (!workflow) return

  return toDeploymentVersion(workflow, workflow.id)
})

const appWorkflowVersionsQueryAtom = atomWithInfiniteQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.apps.byAppId.workflows.get.infiniteOptions({
    input: appId
      ? (pageParam) => ({
          params: {
            app_id: appId,
          },
          query: {
            limit: WORKFLOW_VERSIONS_PAGE_SIZE,
            page: Number(pageParam),
          },
        })
      : skipToken,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })
})

const appWorkflowVersionsDataAtom = selectAtom(appWorkflowVersionsQueryAtom, (query) => query.data)

export const appWorkflowVersionsAtom = atom((get) => {
  const latestWorkflowId = get(latestPublishedWorkflowAtom)?.id
  const pages = get(appWorkflowVersionsDataAtom)?.pages ?? []

  return pages.flatMap((page) =>
    page.items
      .filter((workflow) => workflow.version !== 'draft')
      .map((workflow) => toDeploymentVersion(workflow, latestWorkflowId)),
  )
})

export const appWorkflowVersionsErrorAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.error,
)

export const appWorkflowVersionsFetchNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.fetchNextPage,
)

export const appWorkflowVersionsHasNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.hasNextPage,
)

export const appWorkflowVersionsIsFetchingAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isFetching,
)

export const appWorkflowVersionsIsFetchingNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isFetchingNextPage,
)

export const appWorkflowVersionsIsLoadingAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isLoading,
)

const appEnvironmentsQueryAtom = atomWithQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  })
})

const appEnvironmentsAtom = selectAtom(appEnvironmentsQueryAtom, (query) => query.data?.data)

export const appEnvironmentUsageAtom = atom((get) => {
  const environments = get(appEnvironmentsAtom)
  if (!environments) return

  return {
    total: environments.length,
    used: environments.filter((environment) => environment.in_use).length,
  }
})

export const undeployedAppEnvironmentsAtom = atom(
  (get) => get(appEnvironmentsAtom)?.filter((environment) => environment.in_use === false) ?? [],
)

export function hasInProgressEnvironmentDeployments(deployments: EnvironmentDeployment[]) {
  return deployments.some((row) => {
    const status = row.deployment?.status

    return (
      status === DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING ||
      status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING
    )
  })
}

const appEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
    {
      input: appId
        ? {
            params: {
              app_id: appId,
            },
          }
        : skipToken,
      refetchInterval: (query) => {
        const deployments = query.state.data?.environment_deployments ?? []
        return hasInProgressEnvironmentDeployments(deployments)
          ? DEPLOYMENT_STATUS_POLLING_INTERVAL
          : false
      },
    },
  )
})

export const appEnvironmentDeploymentsAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.data?.environment_deployments,
)

export const appEnvironmentDeploymentsIsLoadingAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.isLoading,
)

export const appEnvironmentDeploymentsIsErrorAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.isError,
)

export function getWorkflowVersionName(version?: WorkflowVersion) {
  if (!version) return

  return version.marked_name || version.version
}

function deploymentActions(
  kinds: EnvironmentDeploymentActionKind[],
  disabled = false,
): EnvironmentDeploymentAction[] {
  return kinds.map((kind) => ({ disabled, kind }))
}

function isLatestDeployOperationFailed(row: EnvironmentDeployment) {
  const operation = row.deployment?.latest_operation

  return (
    operation?.type === DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY &&
    operation.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED
  )
}

export function getEnvironmentDeploymentActions(
  row: EnvironmentDeployment,
): EnvironmentDeploymentAction[] {
  const deployment = row.deployment
  if (!deployment || deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYED) {
    return deploymentActions(['deployLatest', 'changeVersion'])
  }

  const hasCurrentVersion = Boolean(deployment.current_version)
  const hasFailedDeploy =
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_FAILED ||
    (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_RUNNING &&
      isLatestDeployOperationFailed(row))

  if (hasFailedDeploy) {
    return deploymentActions(
      hasCurrentVersion ? ['retry', 'changeVersion', 'undeploy'] : ['retry', 'changeVersion'],
    )
  }

  if (
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING ||
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING
  ) {
    return deploymentActions(['changeVersion', 'redeploy', 'undeploy'], true)
  }

  if (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_RUNNING) {
    if ((deployment.versions_behind ?? 0) > 0) {
      return deploymentActions(['deployLatest', 'changeVersion', 'redeploy', 'undeploy'])
    }

    return deploymentActions(['redeploy', 'changeVersion', 'undeploy'])
  }

  return deploymentActions(['redeploy', 'undeploy'])
}
