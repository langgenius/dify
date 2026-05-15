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

function runtimeDeploymentByEnvironmentId(deploymentRows: EnvironmentDeployment[]) {
  return new Map(
    deploymentRows
      .map((deployment) => {
        const envId = environmentId(deployment.environment)
        return envId ? [envId, deployment] as const : undefined
      })
      .filter((entry): entry is readonly [string, EnvironmentDeployment] => !!entry),
  )
}

function fromDeployedTo(item: DeployedEnvironment, runtimeDeployments: Map<string, EnvironmentDeployment>): ReleaseDeployment | undefined {
  if (!item.environmentId)
    return undefined

  const runtimeDeployment = runtimeDeployments.get(item.environmentId)

  return {
    environmentId: item.environmentId,
    environmentName: item.environmentName || item.environmentId,
    state: runtimeDeployment ? releaseDeploymentState(deploymentStatus(runtimeDeployment)) : 'active',
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

  const runtimeDeployments = runtimeDeploymentByEnvironmentId(deploymentRows)
  const historyItems = row.deployedTo?.map(item => fromDeployedTo(item, runtimeDeployments)).filter((item): item is ReleaseDeployment => !!item) ?? []
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
