'use client'

import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { DocumentFactsSidebar, DocumentReadingPane } from './chunk-detail'
import { DocumentChunkTreePanel } from './chunk-tree'
import {
  documentChunksQueryHasNextPageAtom,
  documentChunksQueryIsFetchingNextPageAtom,
  documentChunksQueryIsFetchNextPageErrorAtom,
  documentDetailSelectedChunkKnownAtom,
  loadNextDocumentChunkPageAtom,
} from './state/content'
import { documentDetailRequestedChunkIdAtom } from './state/inputs'
import { documentDetailRevisionSessionKeyAtom } from './state/revisions'

function RequestedChunkPageLoader() {
  const selectedChunkId = useAtomValueRawSync(documentDetailRequestedChunkIdAtom)
  const selectedChunkKnown = useAtomValueRawSync(documentDetailSelectedChunkKnownAtom)
  const hasNextPage = useAtomValueRawSync(documentChunksQueryHasNextPageAtom)
  const isFetchNextPageError = useAtomValueRawSync(documentChunksQueryIsFetchNextPageErrorAtom)
  const isFetchingNextPage = useAtomValueRawSync(documentChunksQueryIsFetchingNextPageAtom)
  const loadNextPage = useSetAtom(loadNextDocumentChunkPageAtom)

  useEffect(() => {
    if (
      !selectedChunkId ||
      selectedChunkKnown ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    )
      return
    void loadNextPage()
  }, [
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    loadNextPage,
    selectedChunkId,
    selectedChunkKnown,
  ])

  return null
}

export function DocumentRevisionData() {
  const revisionSessionKey = useAtomValueRawSync(documentDetailRevisionSessionKeyAtom)
  if (!revisionSessionKey) return null

  return (
    <div className="mt-4 grid min-h-0 flex-none gap-4 xl:flex-1 xl:grid-cols-[14rem_minmax(0,1fr)_20rem] xl:gap-0">
      <RequestedChunkPageLoader />
      <DocumentChunkTreePanel key={`tree:${revisionSessionKey}`} />
      <DocumentReadingPane key={`content:${revisionSessionKey}`} />
      <DocumentFactsSidebar />
    </div>
  )
}
