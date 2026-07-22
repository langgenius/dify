'use client'

import type {
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { DocumentChunkDetail } from './document-chunk-detail'
import { DocumentChunkTreePanel } from './document-chunk-tree'
import { buildDocumentChunkTree } from './document-detail-model'
import { documentChunksQueryOptions } from './document-detail-queries'

export function DocumentRevisionContent({
  document,
  documentId,
  effectiveRevision,
  knowledgeSpaceId,
  locale,
  revision,
  revisionHistoryError,
  revisionHistoryPending,
  retryRevisionHistory,
}: {
  document: LogicalDocument
  documentId: string
  effectiveRevision?: number
  knowledgeSpaceId: string
  locale: string
  revision?: Exclude<LogicalDocumentRevision, null>
  revisionHistoryError: boolean
  revisionHistoryPending: boolean
  retryRevisionHistory: () => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [selectedChunkId, setSelectedChunkId] = useState<string>()
  const chunksQueryOptions = useMemo(
    () => documentChunksQueryOptions({ documentId, effectiveRevision, knowledgeSpaceId }),
    [documentId, effectiveRevision, knowledgeSpaceId],
  )
  const chunksQuery = useInfiniteQuery(chunksQueryOptions)
  const chunks = useMemo(
    () =>
      [...(chunksQuery.data?.pages.flatMap((page) => page.items) ?? [])].sort(
        (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
      ),
    [chunksQuery.data],
  )
  const tree = useMemo(() => buildDocumentChunkTree(chunks), [chunks])
  const selectedChunk =
    (selectedChunkId ? tree.byId.get(selectedChunkId)?.chunk : undefined) ?? tree.roots[0]?.chunk

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
    <div className="mt-5 grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)_minmax(13rem,16rem)]">
      <DocumentChunkTreePanel
        chunkCount={chunks.length}
        error={Boolean(chunksQuery.error)}
        fetchNextPage={chunksQuery.fetchNextPage}
        hasNextPage={chunksQuery.hasNextPage}
        isFetchNextPageError={chunksQuery.isFetchNextPageError}
        isFetchingNextPage={chunksQuery.isFetchingNextPage}
        isPending={chunksQuery.isPending}
        onRetry={() => void chunksQuery.refetch()}
        onSelectChunk={setSelectedChunkId}
        selectedChunkId={selectedChunk?.id}
        tree={tree}
      />

      <DocumentChunkDetail
        chunks={chunks}
        document={document}
        locale={locale}
        revision={revision}
        selectedChunkId={selectedChunk?.id}
      />
    </div>
  )
}
