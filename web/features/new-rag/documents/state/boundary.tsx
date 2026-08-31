'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useQueryState } from 'nuqs'
import { documentFilterParser, documentSearchParser } from '../query-state'
import { documentFilterAtom, documentSearchAtom, documentsKnowledgeSpaceIdAtom } from './inputs'
import { documentsScopedAtoms } from './scoped'

export function DocumentsStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  const [filter] = useQueryState('status', documentFilterParser)
  const [search] = useQueryState('query', documentSearchParser)

  useHydrateAtoms(
    [
      [documentsKnowledgeSpaceIdAtom, knowledgeSpaceId],
      [documentFilterAtom, filter],
      [documentSearchAtom, search],
    ],
    { dangerouslyForceHydrate: true },
  )

  return (
    <ScopeProvider key={knowledgeSpaceId} atoms={documentsScopedAtoms} name="DocumentsPage">
      {children}
    </ScopeProvider>
  )
}
