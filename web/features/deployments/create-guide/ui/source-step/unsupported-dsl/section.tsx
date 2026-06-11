'use client'

import { useAtomValue } from 'jotai'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { unsupportedDslNodesAtom } from '@/features/deployments/create-guide/state'

export function SourceUnsupportedDslNodesSection() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
