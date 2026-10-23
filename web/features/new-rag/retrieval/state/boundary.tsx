'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { retrievalCanQueryAtom, retrievalKnowledgeSpaceIdAtom } from './inputs'
import { retrievalScopedAtoms } from './scoped'

export function RetrievalStateBoundary({
  children,
  canQuery,
  knowledgeSpaceId,
}: {
  children: ReactNode
  canQuery: boolean
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider
      key={`${knowledgeSpaceId}:${canQuery}`}
      atoms={[
        [retrievalKnowledgeSpaceIdAtom, knowledgeSpaceId],
        [retrievalCanQueryAtom, canQuery],
        ...retrievalScopedAtoms,
      ]}
      name="RetrievalTestPage"
    >
      {children}
    </ScopeProvider>
  )
}
