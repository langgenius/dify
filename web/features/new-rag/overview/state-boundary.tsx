'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { overviewKnowledgeSpaceIdAtom } from './state'

export function OverviewStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[[overviewKnowledgeSpaceIdAtom, knowledgeSpaceId]]}
      name="KnowledgeOverview"
    >
      {children}
    </ScopeProvider>
  )
}
