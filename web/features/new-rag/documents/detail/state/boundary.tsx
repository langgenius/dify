'use client'

import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useQueryStates } from 'nuqs'
import { useEffect } from 'react'
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

  useHydrateAtoms([
    [documentDetailDocumentIdAtom, documentId],
    [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
    [documentDetailRequestedChunkIdAtom, documentLocation.chunk],
    [documentDetailRequestedRevisionAtom, documentLocation.revision],
  ])

  const hydratedDocumentId = useAtomValue(documentDetailDocumentIdAtom)
  const hydratedKnowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const setDocumentId = useSetAtom(documentDetailDocumentIdAtom)
  const setKnowledgeSpaceId = useSetAtom(documentDetailKnowledgeSpaceIdAtom)
  const setRequestedChunkId = useSetAtom(documentDetailRequestedChunkIdAtom)
  const setRequestedRevision = useSetAtom(documentDetailRequestedRevisionAtom)

  useEffect(() => {
    setDocumentId(documentId)
    setKnowledgeSpaceId(knowledgeSpaceId)
    setRequestedChunkId(documentLocation.chunk)
    setRequestedRevision(documentLocation.revision)
  }, [
    documentId,
    documentLocation.chunk,
    documentLocation.revision,
    knowledgeSpaceId,
    setDocumentId,
    setKnowledgeSpaceId,
    setRequestedChunkId,
    setRequestedRevision,
  ])

  if (hydratedDocumentId !== documentId || hydratedKnowledgeSpaceId !== knowledgeSpaceId)
    return null

  return children
}
