import type {
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { InstanceDetailTabKey } from '../detail/tabs'
import { isUndeployedDeploymentRow } from '../runtime-status'

export function getInstanceTabHref(appInstanceId: string, tabKey: InstanceDetailTabKey) {
  return `/deployments/${appInstanceId}/${tabKey}`
}

function hasEnvironment(row: EnvironmentDeployment) {
  return Boolean(row.environment?.id)
}

export function isActiveDeployment(row: EnvironmentDeployment) {
  return hasEnvironment(row) && !isUndeployedDeploymentRow(row)
}

export function isReleaseDeployed(release: Release | undefined, rows: EnvironmentDeployment[]) {
  if (!release?.id)
    return false

  return rows.some(row => row.currentRelease?.id === release.id)
}
