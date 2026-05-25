import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'

type RuntimeInstanceStatusValue = number | string
type RuntimeInstanceStatusRow = {
  status?: RuntimeInstanceStatusValue
}

export type DeploymentUiStatus
  = | 'ready'
    | 'deploying'
    | 'deploy_failed'
    | 'drifted'
    | 'invalid'
    | 'not_deployed'
    | 'unknown'

export const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000
// Mirrors appdeploy/v1/common.proto RuntimeInstanceStatus for EnvironmentDeployment.status.
export const RUNTIME_INSTANCE_STATUS_UNDEPLOYED = 1
export const RUNTIME_INSTANCE_STATUS_DEPLOYING = 2
export const RUNTIME_INSTANCE_STATUS_READY = 3
export const RUNTIME_INSTANCE_STATUS_FAILED = 4
export const RUNTIME_INSTANCE_STATUS_DRIFTED = 5
export const RUNTIME_INSTANCE_STATUS_INVALID = 6

type RuntimeInstanceStatusQueryData = {
  data?: RuntimeInstanceStatusRow[]
}

export function isUndeployedDeploymentRow(row?: EnvironmentDeployment) {
  return deploymentStatus(row) === 'not_deployed'
    || (!row?.currentRelease?.id && !row?.desiredRelease?.id && !row?.currentDeployment?.id)
}

function normalizeRuntimeInstanceStatus(status?: RuntimeInstanceStatusValue) {
  if (typeof status === 'number')
    return status

  const normalized = status?.trim().toUpperCase()
  if (!normalized)
    return undefined

  switch (normalized) {
    case '1':
    case 'UNDEPLOYED':
    case 'RUNTIME_INSTANCE_STATUS_UNDEPLOYED':
      return RUNTIME_INSTANCE_STATUS_UNDEPLOYED
    case '2':
    case 'DEPLOYING':
    case 'RUNTIME_INSTANCE_STATUS_DEPLOYING':
      return RUNTIME_INSTANCE_STATUS_DEPLOYING
    case '3':
    case 'READY':
    case 'RUNTIME_INSTANCE_STATUS_READY':
      return RUNTIME_INSTANCE_STATUS_READY
    case '4':
    case 'FAILED':
    case 'RUNTIME_INSTANCE_STATUS_FAILED':
      return RUNTIME_INSTANCE_STATUS_FAILED
    case '5':
    case 'DRIFTED':
    case 'RUNTIME_INSTANCE_STATUS_DRIFTED':
      return RUNTIME_INSTANCE_STATUS_DRIFTED
    case '6':
    case 'INVALID':
    case 'RUNTIME_INSTANCE_STATUS_INVALID':
      return RUNTIME_INSTANCE_STATUS_INVALID
    default:
      return undefined
  }
}

export function deploymentStatus(row?: RuntimeInstanceStatusRow): DeploymentUiStatus {
  const status = normalizeRuntimeInstanceStatus(row?.status)
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

export function hasDeployingDeployment(rows?: RuntimeInstanceStatusRow[]) {
  return rows?.some(row => deploymentStatus(row) === 'deploying') ?? false
}

export function deploymentStatusPollingInterval(data?: RuntimeInstanceStatusQueryData) {
  return hasDeployingDeployment(data?.data) ? DEPLOYMENT_STATUS_POLLING_INTERVAL : false
}
