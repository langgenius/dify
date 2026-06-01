import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { isUndeployedDeploymentRow } from '../../runtime-status'

export type Drift
  = | { kind: 'undeployed' }
    | { kind: 'unknown' }
    | { kind: 'up-to-date' }
    | { kind: 'behind', steps: number }

export function computeDrift(
  row: EnvironmentDeployment,
  releaseRows: Release[],
): Drift {
  if (isUndeployedDeploymentRow(row))
    return { kind: 'undeployed' }

  const currentReleaseId = row.currentRelease?.id
  if (!currentReleaseId)
    return { kind: 'unknown' }

  const idx = releaseRows.findIndex(release => release.id === currentReleaseId)
  if (idx === -1)
    return { kind: 'unknown' }
  if (idx === 0)
    return { kind: 'up-to-date' }
  return { kind: 'behind', steps: idx }
}

export function latestReleaseId(releaseRows: Release[]): string | undefined {
  return releaseRows[0]?.id || undefined
}
