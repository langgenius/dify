import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'

type DeploymentUiStatus = 'ready' | 'deploying' | 'deploy_failed' | 'unknown'

export const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000
const DEPLOYMENT_STATUS_DEPLOYING = 1
const DEPLOYMENT_STATUS_READY = 2
const DEPLOYMENT_STATUS_FAILED = 3
const DEPLOYMENT_STATUS_CANCELLED = 4

type DeploymentStatusQueryData = {
  data?: Array<Pick<EnvironmentDeployment, 'status'>>
}

export function isUndeployedDeploymentRow(row?: EnvironmentDeployment) {
  return !row?.currentRelease?.id && !row?.desiredRelease?.id && !row?.currentDeployment?.id
}

export function deploymentStatus(row?: Pick<EnvironmentDeployment, 'status'>): DeploymentUiStatus {
  if (!row?.status)
    return 'unknown'
  if (row.status === DEPLOYMENT_STATUS_DEPLOYING)
    return 'deploying'
  if (row.status === DEPLOYMENT_STATUS_FAILED || row.status === DEPLOYMENT_STATUS_CANCELLED)
    return 'deploy_failed'
  if (row.status === DEPLOYMENT_STATUS_READY)
    return 'ready'
  return 'unknown'
}

export function hasDeployingDeployment(rows?: Array<Pick<EnvironmentDeployment, 'status'>>) {
  return rows?.some(row => deploymentStatus(row) === 'deploying') ?? false
}

export function deploymentStatusPollingInterval(data?: DeploymentStatusQueryData) {
  return hasDeployingDeployment(data?.data) ? DEPLOYMENT_STATUS_POLLING_INTERVAL : false
}
