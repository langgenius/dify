'use client'

import type { LogicalDocument, LogicalDocumentRevision } from './document-models'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { DocumentChunkDetail } from './document-chunk-detail'
import { DocumentChunkTreePanel } from './document-chunk-tree'
import { buildDocumentDetailModel } from './document-detail-model'
import {
  documentChunksQueryOptions,
  documentMultimodalQueryOptions,
  documentOutlineQueryOptions,
} from './document-detail-queries'
import { documentChunkListFromApi } from './document-models'

export function DocumentRevisionContent({
  canEdit,
  document,
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
  locale,
  onSelectChunk,
  revision,
  revisionHistoryError,
  revisionHistoryPending,
  retryRevisionHistory,
  selectedChunkId,
}: {
  canEdit: boolean
  document: LogicalDocument
  documentId: string
  effectiveRevision?: number
  knowledgeSpaceId: string
  locale: string
  onSelectChunk: (chunkId: string) => void
  revision?: Exclude<LogicalDocumentRevision, null>
  revisionHistoryError: boolean
  revisionHistoryPending: boolean
  retryRevisionHistory: () => void
  selectedChunkId?: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')

  if (effectiveRevision === undefined && revisionHistoryPending)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loading />
      </div>
    )

  if (effectiveRevision === undefined && revisionHistoryError)
    return (
      <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
        <span aria-hidden className="i-ri-error-warning-line size-8 text-text-destructive" />
        <h2 className="mt-3 title-2xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.documentLoadErrorTitle'])}
        </h2>
        <p className="mt-2 max-w-lg body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        </p>
        <Button className="mt-4" onClick={retryRevisionHistory}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </div>
    )

  if (effectiveRevision === undefined)
    return (
      <div className="flex min-h-80 flex-col items-center justify-center text-center">
        <span aria-hidden className="i-ri-file-warning-line size-8 text-text-tertiary" />
        <h2 className="mt-3 title-xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.documentRevisionMissingTitle'])}
        </h2>
        <p className="mt-2 max-w-lg body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentRevisionMissingDescription'])}
        </p>
      </div>
    )

  return (
    <LoadedDocumentRevisionContent
      canEdit={canEdit}
      document={document}
      documentId={documentId}
      effectiveRevision={effectiveRevision}
      knowledgeSpaceId={knowledgeSpaceId}
      locale={locale}
      onSelectChunk={onSelectChunk}
      revision={revision}
      selectedChunkId={selectedChunkId}
    />
  )
}

function LoadedDocumentRevisionContent({
  canEdit,
  document,
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
  locale,
  onSelectChunk,
  revision,
  selectedChunkId,
}: {
  canEdit: boolean
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

      <DocumentChunkDetail
        canEdit={canEdit}
        controlSpaceId={knowledgeSpaceId}
        contentBlocks={detailModel.contentBlocks}
        chunksComplete={
          Boolean(chunksQuery.data) &&
          !chunksQuery.error &&
          !chunksQuery.hasNextPage &&
          !chunksQuery.isFetchingNextPage &&
          !chunksQuery.isFetchNextPageError
        }
        document={document}
        isLoadingMore={chunksQuery.isFetchingNextPage}
        locale={locale}
        multimodalItems={multimodalItems}
        revision={revision}
        selectedChunkId={selectedBlock?.chunk.id}
        indexChunks={detailModel.indexChunks}
      />
    </div>
  )
}
