import type { Environment, EnvironmentDeployment, Release, ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import { environmentId, environmentName } from '../../environment'
import { deploymentStatus } from '../../runtime-status'

export type ReleaseDeploymentState = 'active' | 'deploying' | 'failed'

export type ReleaseDeployment = {
  environmentId: string
  environmentName: string
  state: ReleaseDeploymentState
}

export type ReleaseWithSummaryDeployments = Release & {
  summaryDeployments?: ReleaseDeployment[]
}

function releaseDeploymentState(status?: string): ReleaseDeploymentState {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('deploying') || normalized.includes('pending'))
    return 'deploying'
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('invalid'))
    return 'failed'
  return 'active'
}

function dedupeReleaseDeployments(items: ReleaseDeployment[]) {
  return items.filter((item, index) => {
    return items.findIndex(candidate => candidate.environmentId === item.environmentId) === index
  })
}

function releaseSummaryEnvironmentDeployment(environment: Environment | undefined, state: ReleaseDeploymentState): ReleaseDeployment | undefined {
  const envId = environmentId(environment)
  if (!envId)
    return undefined

  return {
    environmentId: envId,
    environmentName: environmentName(environment),
    state,
  }
}

export function getReleaseSummaryDeployments(summary: ReleaseSummary) {
  // Each deployed environment carries its runtime status so a failed deployment
  // surfaces as failed instead of being assumed healthy.
  const deployedItems = summary.deployedEnvironments
    ?.map(deployment => releaseSummaryEnvironmentDeployment(deployment.environment, releaseDeploymentState(deployment.status)))
    .filter((item): item is ReleaseDeployment => Boolean(item)) ?? []
  const actionItems = summary.environmentActions
    ?.filter(action => action.kind === 'RELEASE_ENVIRONMENT_ACTION_KIND_DEPLOYING')
    .map(action => releaseSummaryEnvironmentDeployment(action.environment, 'deploying'))
    .filter((item): item is ReleaseDeployment => Boolean(item)) ?? []

  return dedupeReleaseDeployments([
    ...deployedItems,
    ...actionItems,
  ])
}

export function getReleaseDeployments(row: ReleaseWithSummaryDeployments, deploymentRows: EnvironmentDeployment[]) {
  if (row.summaryDeployments)
    return row.summaryDeployments

  const releaseId = row.id
  if (!releaseId)
    return []

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

  return dedupeReleaseDeployments(runtimeItems)
}
