'use client'

import type { ReleaseDeployment } from './release-deployments'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { DeployedToBadge } from './deployed-to-badge'

export function ReleaseDeploymentsSkeleton() {
  return (
    <SkeletonRow className="gap-1">
      <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
      <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
    </SkeletonRow>
  )
}

export function ReleaseDeploymentsContent({
  items,
  isLoading,
  hasError,
  loadFailedLabel,
}: {
  items: ReleaseDeployment[]
  isLoading?: boolean
  hasError?: boolean
  loadFailedLabel: string
}) {
  if (isLoading)
    return <ReleaseDeploymentsSkeleton />

  if (hasError)
    return <span className="text-text-tertiary">{loadFailedLabel}</span>

  if (items.length === 0)
    return <span className="text-text-quaternary">—</span>

  return items.map(item => (
    <DeployedToBadge
      key={`${item.environmentId}-${item.state}`}
      item={item}
    />
  ))
}
