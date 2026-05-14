import type { DeployedEnvironment, EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { environmentId, environmentName } from '../../environment'
import { deploymentStatus } from '../../runtime-status'

export type ReleaseDeploymentState = 'active' | 'deploying' | 'failed'

export type ReleaseDeployment = {
  environmentId: string
  environmentName: string
  state: ReleaseDeploymentState
}

function releaseDeploymentState(status?: string): ReleaseDeploymentState {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('deploying') || normalized.includes('pending'))
    return 'deploying'
  if (normalized.includes('fail') || normalized.includes('error'))
    return 'failed'
  return 'active'
}

function fromDeployedTo(item: DeployedEnvironment): ReleaseDeployment | undefined {
  if (!item.environmentId)
    return undefined

  return {
    environmentId: item.environmentId,
    environmentName: item.environmentName || item.environmentId,
    state: 'active',
  }
}

function dedupeReleaseDeployments(items: ReleaseDeployment[]) {
  return items.filter((item, index) => {
    return items.findIndex(candidate => candidate.environmentId === item.environmentId) === index
  })
}

export function getReleaseDeployments(row: ReleaseRow, deploymentRows: EnvironmentDeployment[]) {
  const releaseId = row.id
  if (!releaseId)
    return []

  const historyItems = row.deployedTo?.map(fromDeployedTo).filter((item): item is ReleaseDeployment => !!item) ?? []
  const runtimeItems = deploymentRows.flatMap((deployment) => {
    const envId = environmentId(deployment.environment)
    if (!envId)
      return []

    const items: ReleaseDeployment[] = []
    if (deployment.currentRelease?.id === releaseId) {
      items.push({
        environmentId: envId,
        environmentName: environmentName(deployment.environment),
        state: releaseDeploymentState(deploymentStatus(deployment)),
      })
    }
    return items
  })

  return dedupeReleaseDeployments([...runtimeItems, ...historyItems])
}
