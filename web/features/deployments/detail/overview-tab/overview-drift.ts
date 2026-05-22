import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { deploymentStatus, isUndeployedDeploymentRow } from '../../runtime-status'

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

export type OverviewStats = {
  total: number
  ready: number
  behind: number
  failed: number
  deploying: number
  undeployed: number
}

export function computeOverviewStats(
  rows: EnvironmentDeployment[],
  releaseRows: Release[],
): OverviewStats {
  const stats: OverviewStats = { total: rows.length, ready: 0, behind: 0, failed: 0, deploying: 0, undeployed: 0 }
  for (const row of rows) {
    const drift = computeDrift(row, releaseRows)
    if (drift.kind === 'undeployed') {
      stats.undeployed += 1
      continue
    }
    const status = deploymentStatus(row)
    if (status === 'deploy_failed') {
      stats.failed += 1
      continue
    }
    if (status === 'deploying') {
      stats.deploying += 1
      continue
    }
    if (drift.kind === 'behind') {
      stats.behind += 1
      continue
    }
    if (status === 'ready')
      stats.ready += 1
  }
  return stats
}
