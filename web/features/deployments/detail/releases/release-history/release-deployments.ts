import type {
  Environment,
  Release,
  ReleaseSummary,
  RuntimeInstanceStatus as RuntimeInstanceStatusValue,
} from '@dify/contracts/enterprise/types.gen'
import {
  ReleaseEnvironmentActionKind,
  RuntimeInstanceStatus,
} from '@dify/contracts/enterprise/types.gen'

export type ReleaseDeployment = {
  environmentId: string
  environmentName: string
  status: RuntimeInstanceStatusValue
}

export type ReleaseWithSummaryDeployments = Release & {
  summaryDeployments: ReleaseDeployment[]
}

function dedupeReleaseDeployments(items: ReleaseDeployment[]) {
  return items.filter((item, index) => {
    return items.findIndex((candidate) => candidate.environmentId === item.environmentId) === index
  })
}

function releaseSummaryEnvironmentDeployment(
  environment: Environment,
  status: RuntimeInstanceStatusValue,
): ReleaseDeployment {
  return {
    environmentId: environment.id,
    environmentName: environment.displayName,
    status,
  }
}

export function getReleaseSummaryDeployments(summary: ReleaseSummary) {
  // Each deployed environment carries its runtime status so a failed deployment
  // surfaces as failed instead of being assumed healthy.
  const deployedItems = summary.deployedEnvironments.map((deployment) =>
    releaseSummaryEnvironmentDeployment(deployment.environment, deployment.status),
  )
  const actionItems = summary.environmentActions
    .filter(
      (action) =>
        action.kind === ReleaseEnvironmentActionKind.RELEASE_ENVIRONMENT_ACTION_KIND_DEPLOYING,
    )
    .map((action) =>
      releaseSummaryEnvironmentDeployment(
        action.environment,
        RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING,
      ),
    )

  return dedupeReleaseDeployments([...deployedItems, ...actionItems])
}
