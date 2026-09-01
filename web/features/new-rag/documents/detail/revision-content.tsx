'use client'

import type { LogicalDocument, LogicalDocumentRevision } from '../models'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { documentChunkListFromApi } from '../models'
import { DocumentFactsSidebar, DocumentReadingPane } from './chunk-detail'
import { DocumentChunkTreePanel } from './chunk-tree'
import { buildDocumentDetailModel } from './model'
import {
  documentChunksQueryOptions,
  documentMultimodalQueryOptions,
  documentOutlineQueryOptions,
} from './queries'

export function DocumentRevisionData({
  document,
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
  locale,
  onSelectChunk,
  revision,
  selectedChunkId,
}: {
  document: LogicalDocument
  documentId: string
  effectiveRevision: number
  knowledgeSpaceId: string
  locale: string
  onSelectChunk: (chunkId: string) => void
  revision?: Exclude<LogicalDocumentRevision, null>
  selectedChunkId?: string
}) {
  const chunksQueryOptions = useMemo(
    () => documentChunksQueryOptions({ documentId, effectiveRevision, knowledgeSpaceId }),
    [documentId, effectiveRevision, knowledgeSpaceId],
  )
  const chunksQuery = useInfiniteQuery(chunksQueryOptions)
  const {
    fetchNextPage: fetchNextChunkPage,
    hasNextPage: hasNextChunkPage,
    isFetchNextPageError: isFetchNextChunkPageError,
    isFetchingNextPage: isFetchingNextChunkPage,
  } = chunksQuery
  const documentAsset =
    revision ?? (document.active?.revision === effectiveRevision ? document.active : undefined)
  const outlineQueryOptions = useMemo(
    () =>
      documentOutlineQueryOptions({
        documentAssetId: documentAsset?.documentAssetId,
        knowledgeSpaceId,
      }),
    [documentAsset?.documentAssetId, knowledgeSpaceId],
  )
  const outlineQuery = useQuery(outlineQueryOptions)
  const multimodalQueryOptions = useMemo(
    () =>
      documentMultimodalQueryOptions({
        documentAssetId: documentAsset?.documentAssetId,
        knowledgeSpaceId,
      }),
    [documentAsset?.documentAssetId, knowledgeSpaceId],
  )
  const multimodalQuery = useQuery(multimodalQueryOptions)
  const chunks = useMemo(
    () =>
      [
        ...(chunksQuery.data?.pages.flatMap((page) => documentChunkListFromApi(page).items) ?? []),
      ].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    [chunksQuery.data],
  )
  const multimodalItems = useMemo(() => {
    const manifest = multimodalQuery.data
    if (!manifest || manifest.version !== documentAsset?.documentAssetVersion) return []
    return manifest.items ?? []
  }, [documentAsset?.documentAssetVersion, multimodalQuery.data])
  const detailModel = useMemo(() => {
    const outline = outlineQuery.data
    return buildDocumentDetailModel(
      chunks,
      outline && outline.version === documentAsset?.documentAssetVersion ? outline.nodes : [],
      multimodalItems,
    )
  }, [chunks, documentAsset?.documentAssetVersion, multimodalItems, outlineQuery.data])
  const targetedBlock = selectedChunkId
    ? detailModel.contentBlocksByChunkId.get(selectedChunkId)
    : undefined
  const selectedChunkKnown = selectedChunkId
    ? detailModel.sourceChunksById.has(selectedChunkId)
    : false
  const targetLookupComplete =
    !selectedChunkId ||
    selectedChunkKnown ||
    (!chunksQuery.isPending && (!hasNextChunkPage || isFetchNextChunkPageError))
  const fallbackBlock = detailModel.tree.roots[0]
    ? detailModel.contentBlocksByChunkId.get(detailModel.tree.roots[0].targetChunkId)
    : undefined
  const selectedBlock = targetedBlock ?? (targetLookupComplete ? fallbackBlock : undefined)
  const revisionSessionKey = `${documentId}:${effectiveRevision}`

  useEffect(() => {
    if (
      !selectedChunkId ||
      selectedChunkKnown ||
      !hasNextChunkPage ||
      isFetchingNextChunkPage ||
      isFetchNextChunkPageError
    )
      return
    void fetchNextChunkPage()
  }, [
    fetchNextChunkPage,
    hasNextChunkPage,
    isFetchNextChunkPageError,
    isFetchingNextChunkPage,
    selectedChunkId,
    selectedChunkKnown,
  ])

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_20rem] xl:gap-0">
      <DocumentChunkTreePanel
        key={`tree:${revisionSessionKey}`}
        chunkCount={chunks.length}
        error={Boolean(chunksQuery.error)}
        fetchNextPage={chunksQuery.fetchNextPage}
        hasNextPage={chunksQuery.hasNextPage}
        isFetchNextPageError={chunksQuery.isFetchNextPageError}
        isFetchingNextPage={chunksQuery.isFetchingNextPage}
        isPending={chunksQuery.isPending}
        onRetry={() => void chunksQuery.refetch()}
        onSelectChunk={onSelectChunk}
        selectedChunkId={selectedBlock?.chunk.id}
        tree={detailModel.tree}
      />

      <DocumentReadingPane
        key={`content:${revisionSessionKey}`}
        contentBlocks={detailModel.contentBlocks}
        isLoadingMore={chunksQuery.isFetchingNextPage}
        multimodalItems={multimodalItems}
        selectedChunkId={selectedBlock?.chunk.id}
      />

      <DocumentFactsSidebar
        key={`facts:${documentId}`}
        chunksComplete={
          Boolean(chunksQuery.data) &&
          !chunksQuery.error &&
          !chunksQuery.hasNextPage &&
          !chunksQuery.isFetchingNextPage &&
          !chunksQuery.isFetchNextPageError
        }
        controlSpaceId={knowledgeSpaceId}
        document={document}
        indexChunks={detailModel.indexChunks}
        locale={locale}
        revision={revision}
      />
    </div>
  )
}
