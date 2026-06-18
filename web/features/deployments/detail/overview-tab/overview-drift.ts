import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { isUndeployedDeploymentRow } from '../../shared/domain/runtime-status'

export type Drift
  = | { kind: 'undeployed' }
    | { kind: 'unknown' }
    | { kind: 'up-to-date' }
    | { kind: 'behind', steps: number }

export function computeDrift(row: EnvironmentDeployment): Drift {
  if (isUndeployedDeploymentRow(row))
    return { kind: 'undeployed' }

  if (!row.currentRelease)
    return { kind: 'unknown' }

  // releasesBehind is server-computed against the full release history (0 == up
  // to date). It is absent only when undetermined, which renders as unknown.
  const behind = row.releasesBehind
  if (behind == null)
    return { kind: 'unknown' }
  if (behind === 0)
    return { kind: 'up-to-date' }
  return { kind: 'behind', steps: behind }
}

export function latestReleaseId(releaseRows: Release[]): string | undefined {
  return releaseRows[0]?.id
}
