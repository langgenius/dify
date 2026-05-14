import type { ReleaseRow, ReleaseSummary } from '@dify/contracts/enterprise/types.gen'

export type ReleaseDeploymentAction = 'deploy' | 'deployExistingRelease' | 'promote' | 'rollback'

function releaseCreatedAt(release?: ReleaseSummary | ReleaseRow) {
  const value = release?.createdAt
  if (!value)
    return undefined

  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function releaseById(releaseRows: ReleaseRow[], releaseId?: string) {
  return releaseRows.find(release => release.id === releaseId)
}

function releaseOrderIndex(releaseRows: ReleaseRow[], releaseId?: string) {
  return releaseRows.findIndex(release => release.id === releaseId)
}

function compareReleaseOrder(targetRelease: ReleaseSummary | ReleaseRow | undefined, currentRelease: ReleaseSummary, releaseRows: ReleaseRow[]) {
  if (!targetRelease?.id || !currentRelease.id)
    return undefined
  if (targetRelease.id === currentRelease.id)
    return 0

  const normalizedTargetRelease = releaseById(releaseRows, targetRelease.id) ?? targetRelease
  const normalizedCurrentRelease = releaseById(releaseRows, currentRelease.id) ?? currentRelease
  const targetCreatedAt = releaseCreatedAt(normalizedTargetRelease)
  const currentCreatedAt = releaseCreatedAt(normalizedCurrentRelease)

  if (targetCreatedAt !== undefined && currentCreatedAt !== undefined && targetCreatedAt !== currentCreatedAt)
    return targetCreatedAt > currentCreatedAt ? 1 : -1

  const targetIndex = releaseOrderIndex(releaseRows, targetRelease.id)
  const currentIndex = releaseOrderIndex(releaseRows, currentRelease.id)
  if (targetIndex >= 0 && currentIndex >= 0 && targetIndex !== currentIndex)
    return targetIndex < currentIndex ? 1 : -1

  return undefined
}

export function releaseDeploymentAction({
  targetRelease,
  currentRelease,
  releaseRows,
  isExistingRelease,
}: {
  targetRelease?: ReleaseSummary | ReleaseRow
  currentRelease?: ReleaseSummary
  releaseRows: ReleaseRow[]
  isExistingRelease?: boolean
}): ReleaseDeploymentAction {
  if (!currentRelease?.id)
    return isExistingRelease ? 'deployExistingRelease' : 'deploy'

  const order = compareReleaseOrder(targetRelease, currentRelease, releaseRows)
  if (order === -1)
    return 'rollback'
  if (order === 1)
    return 'promote'

  return targetRelease?.id && targetRelease.id !== currentRelease.id
    ? 'promote'
    : isExistingRelease
      ? 'deployExistingRelease'
      : 'deploy'
}
