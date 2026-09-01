'use client'

import { useAtomValue, useSetAtom } from 'jotai'
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
  const selectedChunkId = useAtomValue(documentDetailRequestedChunkIdAtom)
  const selectedChunkKnown = useAtomValue(documentDetailSelectedChunkKnownAtom)
  const hasNextPage = useAtomValue(documentChunksQueryHasNextPageAtom)
  const isFetchNextPageError = useAtomValue(documentChunksQueryIsFetchNextPageErrorAtom)
  const isFetchingNextPage = useAtomValue(documentChunksQueryIsFetchingNextPageAtom)
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
  const revisionSessionKey = useAtomValue(documentDetailRevisionSessionKeyAtom)
  if (!revisionSessionKey) return null

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_20rem] xl:gap-0">
      <RequestedChunkPageLoader />
      <DocumentChunkTreePanel key={`tree:${revisionSessionKey}`} />
      <DocumentReadingPane key={`content:${revisionSessionKey}`} />
      <DocumentFactsSidebar />
    </div>
  )
}
