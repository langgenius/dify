'use client'

import { useAtomValue } from 'jotai'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { unsupportedDslNodesAtom } from '../../../state/unsupported-dsl-atoms'
import { useDeploymentOptionsUnsupportedDslNodeSync } from './section.data'

export function TargetUnsupportedDslNodesSection() {
  useDeploymentOptionsUnsupportedDslNodeSync()
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  if (unsupportedDslNodes.length === 0)
    return null

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
