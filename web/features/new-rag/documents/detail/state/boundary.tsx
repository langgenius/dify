'use client'

import type { ReactNode } from 'react'
import { useHydrateAtoms } from 'jotai/utils'
import { useQueryStates } from 'nuqs'
import {
  documentDetailDocumentIdAtom,
  documentDetailKnowledgeSpaceIdAtom,
  documentDetailRequestedChunkIdAtom,
  documentDetailRequestedRevisionAtom,
} from './inputs'
import { documentDetailChunkParser, documentDetailRevisionParser } from './location'

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

  useHydrateAtoms(
    [
      [documentDetailDocumentIdAtom, documentId],
      [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
      [documentDetailRequestedChunkIdAtom, documentLocation.chunk],
      [documentDetailRequestedRevisionAtom, documentLocation.revision],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}
