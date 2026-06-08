import type { ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import type { ReleaseWithSummaryDeployments } from './release-deployments'
import { getReleaseSummaryDeployments } from './release-deployments'

export type ReleaseRowWithId = ReleaseWithSummaryDeployments & {
  id: string
}

export function releaseRowFromSummary(summary: ReleaseSummary): ReleaseRowWithId | undefined {
  if (!summary.release?.id)
    return undefined

  return {
    ...summary.release,
    id: summary.release.id,
    summaryDeployments: getReleaseSummaryDeployments(summary),
  }
}
