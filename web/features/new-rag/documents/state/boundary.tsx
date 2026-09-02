'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { documentsKnowledgeSpaceIdAtom } from './inputs'
import { documentsScopedAtoms } from './scoped'

export function DocumentsStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  useHydrateAtoms([[documentsKnowledgeSpaceIdAtom, knowledgeSpaceId]], {
    dangerouslyForceHydrate: true,
  })

  return (
    <ScopeProvider key={knowledgeSpaceId} atoms={documentsScopedAtoms} name="DocumentsPage">
      {children}
    </ScopeProvider>
  )
}
