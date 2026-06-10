'use client'

import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { useTargetUnsupportedDslSectionData } from './section-data'

export function TargetUnsupportedDslNodesSection() {
  const {
    hasUnsupportedDslNodes,
    unsupportedDslNodes,
  } = useTargetUnsupportedDslSectionData()

  if (!hasUnsupportedDslNodes)
    return null

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
