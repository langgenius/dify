import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'

type DeploymentUiStatus = 'ready' | 'deploying' | 'deploy_failed' | 'unknown'

export function isUndeployedDeploymentRow(row?: EnvironmentDeployment) {
  return (row?.status?.toLowerCase() ?? '').includes('undeployed') || (!row?.runtime?.runtimeInstanceId && !row?.currentRelease && !row?.runtime)
}

export function deploymentStatus(row?: Pick<EnvironmentDeployment, 'status'>): DeploymentUiStatus {
  const runtimeStatus = row?.status?.toLowerCase() ?? ''
  if (!runtimeStatus || runtimeStatus.includes('undeployed'))
    return 'unknown'
  if (runtimeStatus.includes('deploying') || runtimeStatus.includes('pending'))
    return 'deploying'
  if (runtimeStatus.includes('fail') || runtimeStatus.includes('error'))
    return 'deploy_failed'
  if (runtimeStatus.includes('ready')
    || runtimeStatus.includes('running')
    || runtimeStatus.includes('active')
    || runtimeStatus.includes('success')
    || runtimeStatus.includes('succeed')
    || runtimeStatus.includes('deployed')) {
    return 'ready'
  }
  return 'unknown'
}
