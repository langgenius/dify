import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'

type RuntimeInstanceStatusValue = NonNullable<EnvironmentDeployment['status']>

export type DeploymentUiStatus
  = | 'ready'
    | 'deploying'
    | 'deploy_failed'
    | 'drifted'
    | 'invalid'
    | 'not_deployed'
    | 'undeploying'
    | 'unknown'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000
const deploymentUiStatusByRuntimeStatus = {
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED]: 'unknown',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED]: 'not_deployed',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING]: 'deploying',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY]: 'ready',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED]: 'deploy_failed',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED]: 'drifted',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID]: 'invalid',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING]: 'undeploying',
} satisfies Record<RuntimeInstanceStatusValue, DeploymentUiStatus>

export function isUndeployedDeploymentRow(row?: EnvironmentDeployment) {
  const status = deploymentStatus(row)
  return status === 'not_deployed'
    || (status === 'unknown' && !row?.currentRelease?.id && !row?.desiredRelease?.id && !row?.currentDeployment?.id)
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
  return deploymentUiStatusByRuntimeStatus[status]
}

function hasDeployingDeployment(rows?: EnvironmentDeployment[]) {
  return rows?.some((row) => {
    const status = deploymentStatus(row)
    return status === 'deploying' || status === 'undeploying'
  }) ?? false
}

export function deploymentStatusPollingInterval(rows?: EnvironmentDeployment[]) {
  return hasDeployingDeployment(rows) ? DEPLOYMENT_STATUS_POLLING_INTERVAL : false
}
