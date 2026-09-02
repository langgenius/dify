'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { retrievalKnowledgeSpaceIdAtom } from './inputs'
import { retrievalScopedAtoms } from './scoped'

export function RetrievalStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[[retrievalKnowledgeSpaceIdAtom, knowledgeSpaceId], ...retrievalScopedAtoms]}
      name="RetrievalTestPage"
    >
      {children}
    </ScopeProvider>
  )
}
