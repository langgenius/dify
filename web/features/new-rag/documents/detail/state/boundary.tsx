'use client'

import type { ReactNode } from 'react'
import { useHydrateAtoms } from 'jotai/utils'
import { createParser, parseAsString, useQueryStates } from 'nuqs'
import {
  documentDetailDocumentIdAtom,
  documentDetailKnowledgeSpaceIdAtom,
  documentDetailRequestedChunkIdAtom,
  documentDetailRequestedRevisionAtom,
} from './inputs'
import { documentDetailLocationRuntimeAtom } from './runtime'

const documentRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })
const documentChunkParser = parseAsString.withOptions({ history: 'replace' })

export function DocumentDetailStateBoundary({
  children,
  documentId,
  knowledgeSpaceId,
}: {
  children: ReactNode
  documentId: string
  knowledgeSpaceId: string
}) {
  const [documentLocation, setDocumentLocation] = useQueryStates({
    chunk: documentChunkParser,
    revision: documentRevisionParser,
  })

  useHydrateAtoms(
    [
      [documentDetailDocumentIdAtom, documentId],
      [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
      [documentDetailRequestedChunkIdAtom, documentLocation.chunk],
      [documentDetailRequestedRevisionAtom, documentLocation.revision],
      [documentDetailLocationRuntimeAtom, { setDocumentLocation }],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}
