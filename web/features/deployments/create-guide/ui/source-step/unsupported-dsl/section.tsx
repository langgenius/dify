'use client'

import { useAtomValue } from 'jotai'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { unsupportedDslNodesAtom } from '../../../state/unsupported-dsl-derived-atoms'

export function SourceUnsupportedDslNodesSection() {
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
}
