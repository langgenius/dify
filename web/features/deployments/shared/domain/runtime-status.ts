import type {
  EnvironmentDeployment,
  RuntimeInstanceStatus as RuntimeInstanceStatusValue,
} from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000

export function isUndeployedDeploymentRow(row: EnvironmentDeployment) {
  const status = row.status
  return (
    status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED ||
    (status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED &&
      !row.currentRelease &&
      !row.desiredRelease &&
      !row.currentDeployment)
  )
}

export function hasRuntimeInstanceDeployment(row: EnvironmentDeployment) {
  return !isUndeployedDeploymentRow(row)
}

export function isAvailableDeploymentTarget(row: EnvironmentDeployment) {
  return isUndeployedDeploymentRow(row)
}

export function isRuntimeDeploymentInProgress(status?: RuntimeInstanceStatusValue) {
  return (
    status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING ||
    status === RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING
  )
}

export function deploymentStatusPollingInterval(rows?: EnvironmentDeployment[]) {
  return rows?.some((row) => isRuntimeDeploymentInProgress(row.status))
    ? DEPLOYMENT_STATUS_POLLING_INTERVAL
    : false
}
