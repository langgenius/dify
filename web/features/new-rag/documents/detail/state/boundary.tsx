'use client'

import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { createParser, parseAsString, useQueryStates } from 'nuqs'
import { useEffect, useMemo } from 'react'
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
  const locationRuntime = useMemo(() => ({ setDocumentLocation }), [setDocumentLocation])

  useHydrateAtoms([
    [documentDetailDocumentIdAtom, documentId],
    [documentDetailKnowledgeSpaceIdAtom, knowledgeSpaceId],
    [documentDetailRequestedChunkIdAtom, documentLocation.chunk],
    [documentDetailRequestedRevisionAtom, documentLocation.revision],
    [documentDetailLocationRuntimeAtom, locationRuntime],
  ])

  const hydratedDocumentId = useAtomValue(documentDetailDocumentIdAtom)
  const hydratedKnowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const setDocumentId = useSetAtom(documentDetailDocumentIdAtom)
  const setKnowledgeSpaceId = useSetAtom(documentDetailKnowledgeSpaceIdAtom)
  const setRequestedChunkId = useSetAtom(documentDetailRequestedChunkIdAtom)
  const setRequestedRevision = useSetAtom(documentDetailRequestedRevisionAtom)
  const setLocationRuntime = useSetAtom(documentDetailLocationRuntimeAtom)

  useEffect(() => {
    setDocumentId(documentId)
    setKnowledgeSpaceId(knowledgeSpaceId)
    setRequestedChunkId(documentLocation.chunk)
    setRequestedRevision(documentLocation.revision)
    setLocationRuntime(locationRuntime)
  }, [
    documentId,
    documentLocation.chunk,
    documentLocation.revision,
    knowledgeSpaceId,
    locationRuntime,
    setDocumentId,
    setKnowledgeSpaceId,
    setLocationRuntime,
    setRequestedChunkId,
    setRequestedRevision,
  ])

  if (hydratedDocumentId !== documentId || hydratedKnowledgeSpaceId !== knowledgeSpaceId)
    return null

  return children
}
