import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'

type RuntimeInstanceStatus = NonNullable<EnvironmentDeployment['status']>

export type DeploymentUiStatus
  = | 'ready'
    | 'deploying'
    | 'deploy_failed'
    | 'drifted'
    | 'invalid'
    | 'not_deployed'
    | 'unknown'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000
// Mirrors appdeploy/v1/common.proto RuntimeInstanceStatus for EnvironmentDeployment.status.
const RUNTIME_INSTANCE_STATUS_UNDEPLOYED = 'RUNTIME_INSTANCE_STATUS_UNDEPLOYED' satisfies RuntimeInstanceStatus
const RUNTIME_INSTANCE_STATUS_DEPLOYING = 'RUNTIME_INSTANCE_STATUS_DEPLOYING' satisfies RuntimeInstanceStatus
const RUNTIME_INSTANCE_STATUS_READY = 'RUNTIME_INSTANCE_STATUS_READY' satisfies RuntimeInstanceStatus
const RUNTIME_INSTANCE_STATUS_FAILED = 'RUNTIME_INSTANCE_STATUS_FAILED' satisfies RuntimeInstanceStatus
const RUNTIME_INSTANCE_STATUS_DRIFTED = 'RUNTIME_INSTANCE_STATUS_DRIFTED' satisfies RuntimeInstanceStatus
const RUNTIME_INSTANCE_STATUS_INVALID = 'RUNTIME_INSTANCE_STATUS_INVALID' satisfies RuntimeInstanceStatus

export function isUndeployedDeploymentRow(row?: EnvironmentDeployment) {
  return deploymentStatus(row) === 'not_deployed'
    || (!row?.currentRelease?.id && !row?.desiredRelease?.id && !row?.currentDeployment?.id)
}

export function hasRuntimeInstanceDeployment(row?: EnvironmentDeployment) {
  return Boolean(row?.environment?.id && !isUndeployedDeploymentRow(row))
}

export function isAvailableDeploymentTarget(row?: EnvironmentDeployment) {
  return Boolean(row?.environment?.id && isUndeployedDeploymentRow(row))
}

export function deploymentStatus(row?: EnvironmentDeployment): DeploymentUiStatus {
  const status = row?.status
  if (!status)
    return 'unknown'
  if (status === RUNTIME_INSTANCE_STATUS_UNDEPLOYED)
    return 'not_deployed'
  if (status === RUNTIME_INSTANCE_STATUS_DEPLOYING)
    return 'deploying'
  if (status === RUNTIME_INSTANCE_STATUS_FAILED)
    return 'deploy_failed'
  if (status === RUNTIME_INSTANCE_STATUS_READY)
    return 'ready'
  if (status === RUNTIME_INSTANCE_STATUS_DRIFTED)
    return 'drifted'
  if (status === RUNTIME_INSTANCE_STATUS_INVALID)
    return 'invalid'
  return 'unknown'
}

function hasDeployingDeployment(rows?: EnvironmentDeployment[]) {
  return rows?.some(row => deploymentStatus(row) === 'deploying') ?? false
}

export function deploymentStatusPollingInterval(rows?: EnvironmentDeployment[]) {
  return hasDeployingDeployment(rows) ? DEPLOYMENT_STATUS_POLLING_INTERVAL : false
}
