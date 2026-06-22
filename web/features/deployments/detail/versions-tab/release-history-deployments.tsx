'use client'

import type { ReleaseDeployment } from './release-deployments'
import { DeployedToBadge } from './deployed-to-badge'

export function ReleaseDeploymentsContent({
  items,
}: {
  items: ReleaseDeployment[]
}) {
  if (items.length === 0)
    return <span className="text-text-quaternary">—</span>

  return items.map(item => (
    <DeployedToBadge
      key={`${item.environmentId}-${item.status}`}
      item={item}
    />
  ))
}
