import type { Environment, Release, ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import { environmentId, environmentName } from '../../environment'

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

function releaseSummaryEnvironmentDeployment(environment: Environment | undefined, state: ReleaseDeploymentState): ReleaseDeployment[] {
  const envId = environmentId(environment)
  if (!envId)
    return []

  return [{
    environmentId: envId,
    environmentName: environmentName(environment),
    state,
  }]
}

export function getReleaseSummaryDeployments(summary: ReleaseSummary) {
  // Each deployed environment carries its runtime status so a failed deployment
  // surfaces as failed instead of being assumed healthy.
  const deployedItems = summary.deployedEnvironments
    ?.flatMap(deployment => releaseSummaryEnvironmentDeployment(deployment.environment, releaseDeploymentState(deployment.status))) ?? []
  const actionItems = summary.environmentActions
    ?.filter(action => action.kind === 'RELEASE_ENVIRONMENT_ACTION_KIND_DEPLOYING')
    .flatMap(action => releaseSummaryEnvironmentDeployment(action.environment, 'deploying')) ?? []

  return dedupeReleaseDeployments([
    ...deployedItems,
    ...actionItems,
  ])
}

export function getReleaseDeployments(row: ReleaseWithSummaryDeployments) {
  return row.summaryDeployments ?? []
}
