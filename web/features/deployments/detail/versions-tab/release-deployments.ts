import type { Environment, Release, ReleaseSummary, RuntimeInstanceStatus as RuntimeInstanceStatusValue } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
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

const releaseDeploymentStateByStatus = {
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED]: 'active',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED]: 'active',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING]: 'deploying',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY]: 'active',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED]: 'failed',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED]: 'active',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID]: 'failed',
  [RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING]: 'deploying',
} satisfies Record<RuntimeInstanceStatusValue, ReleaseDeploymentState>

function releaseDeploymentState(status?: RuntimeInstanceStatusValue): ReleaseDeploymentState {
  if (!status)
    return 'active'

  return releaseDeploymentStateByStatus[status]
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
