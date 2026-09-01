'use client'

import type { ReactNode } from 'react'
import { useHydrateAtoms } from 'jotai/utils'
import { documentDetailDocumentIdAtom, documentDetailKnowledgeSpaceIdAtom } from './inputs'

export function DocumentDetailStateBoundary({
  children,
  documentId,
  knowledgeSpaceId,
}: {
  children: ReactNode
  documentId: string
  knowledgeSpaceId: string
}) {
  useHydrateAtoms(
    [
      [documentDetailDocumentIdAtom, documentId],
      [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}
