'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { documentDetailDocumentIdAtom, documentDetailKnowledgeSpaceIdAtom } from './inputs'
import { documentWorkflowScopedAtoms } from './workflow'

export function DocumentDetailStateBoundary({
  children,
  documentId,
  knowledgeSpaceId,
}: {
  children: ReactNode
  documentId: string
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider
      key={`${knowledgeSpaceId}:${documentId}`}
      atoms={[
        [documentDetailDocumentIdAtom, documentId],
        [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
        ...documentWorkflowScopedAtoms,
      ]}
      name="DocumentDetailPage"
    >
      {children}
    </ScopeProvider>
  )
}
