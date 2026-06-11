'use client'

import { useAtomValue } from 'jotai'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import {
  unsupportedDslNodesAtom,
} from '@/features/deployments/create-guide/state'

export function TargetUnsupportedDslNodesSection() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  if (unsupportedDslNodes.length === 0)
    return null

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
