'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useQueryStates } from 'nuqs'
import {
  documentDetailDocumentIdAtom,
  documentDetailKnowledgeSpaceIdAtom,
  documentDetailRequestedChunkIdAtom,
  documentDetailRequestedRevisionAtom,
} from './inputs'
import { documentDetailChunkParser, documentDetailRevisionParser } from './location'
import { documentWorkflowScopedAtoms } from './workflow'

function DocumentDetailLocationBridge({
  children,
  chunkId,
  revision,
}: {
  children: ReactNode
  chunkId: string | null
  revision: number | null
}) {
  useHydrateAtoms(
    [
      [documentDetailRequestedChunkIdAtom, chunkId],
      [documentDetailRequestedRevisionAtom, revision],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}

export function DocumentDetailStateBoundary({
  children,
  documentId,
  knowledgeSpaceId,
}: {
  children: ReactNode
  documentId: string
  knowledgeSpaceId: string
}) {
  const [documentLocation] = useQueryStates({
    chunk: documentDetailChunkParser,
    revision: documentDetailRevisionParser,
  })

  return (
    <ScopeProvider
      key={`${knowledgeSpaceId}:${documentId}`}
      atoms={[
        [documentDetailDocumentIdAtom, documentId],
        [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
        [documentDetailRequestedChunkIdAtom, documentLocation.chunk],
        [documentDetailRequestedRevisionAtom, documentLocation.revision],
        ...documentWorkflowScopedAtoms,
      ]}
      name="DocumentDetailPage"
    >
      <DocumentDetailLocationBridge
        chunkId={documentLocation.chunk}
        revision={documentLocation.revision}
      >
        {children}
      </DocumentDetailLocationBridge>
    </ScopeProvider>
  )
}
