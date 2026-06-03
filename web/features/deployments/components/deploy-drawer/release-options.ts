import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { environmentId } from '../../environment'

export function currentReleaseIdForEnvironment(rows: EnvironmentDeployment[], targetEnvironmentId?: string) {
  if (!targetEnvironmentId)
    return undefined

  return rows.find(row => environmentId(row.environment) === targetEnvironmentId)?.currentRelease?.id
}

export function selectableDeployReleases({
  releases,
  lockedEnvId,
  currentReleaseId,
  presetReleaseId,
}: {
  releases: Release[]
  lockedEnvId?: string
  currentReleaseId?: string
  presetReleaseId?: string
}) {
  if (!lockedEnvId || presetReleaseId || !currentReleaseId)
    return releases

  return releases.filter(release => release.id !== currentReleaseId)
}
