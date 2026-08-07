'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { toDeploymentVersion } from './version'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000

type EnvironmentDeploymentActionKind =
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
const defaultWorkflowVersionNameAtom = atom('')

export function AppDeployStateBoundary({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  const { t } = useTranslation('workflow')

  useHydrateAtoms(
    [
      [appDeployAppIdAtom, appId],
      [defaultWorkflowVersionNameAtom, t(($) => $['versionHistory.defaultName'])],
    ] as const,
    {
      dangerouslyForceHydrate: true,
    },
  )

  return children
}

const latestPublishedWorkflowQueryAtom = atomWithQuery((get) => {
  return appWorkflowQueryOptions(get(appDeployAppIdAtom))
})

const latestPublishedWorkflowAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.data,
)

export const latestAppWorkflowVersionAtom = atom((get) => {
  const workflow = get(latestPublishedWorkflowAtom)
  if (!workflow) return

  return toDeploymentVersion(workflow, get(defaultWorkflowVersionNameAtom), workflow.id)
})

const appWorkflowVersionsQueryAtom = atomWithInfiniteQuery((get) => {
  return appWorkflowVersionsInfiniteQueryOptions(get(appDeployAppIdAtom))
})

const appWorkflowVersionsDataAtom = selectAtom(appWorkflowVersionsQueryAtom, (query) => query.data)

export const appWorkflowVersionsAtom = atom((get) => {
  const latestWorkflowId = get(latestPublishedWorkflowAtom)?.id
  const defaultName = get(defaultWorkflowVersionNameAtom)
  const pages = get(appWorkflowVersionsDataAtom)?.pages ?? []

  return pages.flatMap((page) =>
    page.items
      .filter((workflow) => workflow.version !== 'draft')
      .map((workflow) => toDeploymentVersion(workflow, defaultName, latestWorkflowId)),
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

export function isEnvironmentDeploymentInProgress(deployment?: EnvironmentDeployment) {
  const status = deployment?.deployment?.status

  return (
    status === DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING ||
    status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING
  )
}

export function hasInProgressEnvironmentDeployments(deployments: EnvironmentDeployment[]) {
  return deployments.some(isEnvironmentDeploymentInProgress)
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

export const appEnvironmentDeploymentsIsFetchingAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.isFetching,
)

export const appEnvironmentDeploymentsRefetchAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.refetch,
)

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
  // Currently, this case may not be possible, but we still handle it to avoid potential errors in the future.
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

    return deploymentActions(['changeVersion', 'redeploy', 'undeploy'])
  }

  return deploymentActions(['redeploy', 'undeploy'])
}
