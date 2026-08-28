import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'

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

function isDeploymentOperationInProgress(deployment?: EnvironmentDeployment) {
  return (
    deployment?.deployment?.latest_operation?.status ===
    DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS
  )
}

export function shouldPollEnvironmentDeployment(deployment?: EnvironmentDeployment) {
  if (isDeploymentOperationInProgress(deployment)) return true

  const status = deployment?.deployment?.status
  return (
    status === DeploymentStatus.DEPLOYMENT_STATUS_STARTING ||
    status === DeploymentStatus.DEPLOYMENT_STATUS_STOPPING
  )
}

export function hasDeploymentsRequiringPolling(deployments: EnvironmentDeployment[]) {
  return deployments.some(shouldPollEnvironmentDeployment)
}

function deploymentActions(
  kinds: EnvironmentDeploymentActionKind[],
  disabled = false,
  deployLatestDisabled = false,
): EnvironmentDeploymentAction[] {
  return kinds.map((kind) => ({
    disabled: disabled || (kind === 'deployLatest' && deployLatestDisabled),
    kind,
  }))
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
  { deployLatestDisabled = false }: { deployLatestDisabled?: boolean } = {},
): EnvironmentDeploymentAction[] {
  const deployment = row.deployment
  const actions = (kinds: EnvironmentDeploymentActionKind[], disabled = false) =>
    deploymentActions(kinds, disabled, deployLatestDisabled)

  if (!deployment) {
    return actions(['deployLatest', 'changeVersion'])
  }

  const hasCurrentVersion = Boolean(deployment.current_version)
  if (isDeploymentOperationInProgress(row)) {
    return actions(
      hasCurrentVersion
        ? ['changeVersion', 'redeploy', 'undeploy']
        : ['deployLatest', 'changeVersion'],
      true,
    )
  }

  if (isLatestDeployOperationFailed(row)) {
    const hasRetryVersion = Boolean(
      deployment.latest_operation?.target_version ?? deployment.current_version,
    )
    if (!hasRetryVersion) return actions(['changeVersion'])

    return actions(
      hasCurrentVersion ? ['retry', 'changeVersion', 'undeploy'] : ['retry', 'changeVersion'],
    )
  }

  if (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYED) {
    return actions(['deployLatest', 'changeVersion'])
  }

  if (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_RUNNING) {
    if ((deployment.versions_behind ?? 0) > 0) {
      return actions(['deployLatest', 'changeVersion', 'redeploy', 'undeploy'])
    }

    return actions(['changeVersion', 'redeploy', 'undeploy'])
  }

  if (
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_STARTING ||
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_STOPPING
  ) {
    return actions(
      hasCurrentVersion
        ? ['changeVersion', 'redeploy', 'undeploy']
        : ['deployLatest', 'changeVersion'],
      true,
    )
  }

  return hasCurrentVersion ? actions(['redeploy', 'undeploy']) : actions(['changeVersion'])
}
