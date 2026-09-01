'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { createParser, parseAsString, useQueryStates } from 'nuqs'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { documentRevisionListFromApi } from '../models'
import { initialDocumentRevision } from './model'
import { DocumentRevisionData } from './revision-content'
import { documentDetailKnowledgeSpaceIdAtom } from './state/inputs'
import { documentDetailDocumentAtom } from './state/queries'

const documentRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })
const documentChunkParser = parseAsString.withOptions({ history: 'replace' })

function RevisionLoadingState() {
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="flex min-h-80 min-w-0 flex-1 items-center justify-center">
      <Loading />
      <span className="sr-only">{tCommon(($) => $.loading)}</span>
    </div>
  )
}

function RevisionErrorState({
  description,
  onRetry,
  title,
}: {
  description: string
  onRetry?: () => void
  title: string
}) {
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <span aria-hidden className="i-ri-error-warning-line size-8 text-text-destructive" />
      <h2 className="mt-3 title-2xl-semi-bold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-lg body-sm-regular text-text-tertiary">{description}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}

export function DocumentRevisionBrowser() {
  const { i18n, t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const document = useAtomValue(documentDetailDocumentAtom)
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [documentLocation, setDocumentLocation] = useQueryStates({
    chunk: documentChunkParser,
    revision: documentRevisionParser,
  })
  const { chunk: selectedChunkId, revision: selectedRevision } = documentLocation
  const revisionsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.get.infiniteOptions(
      {
        input: (pageParam) => ({
          params: {
            control_space_id: knowledgeSpaceId,
            document_id: document.id,
          },
          query: {
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          },
        }),
        getNextPageParam: (lastPage) => lastPage.next_cursor,
        initialPageParam: null as string | null,
      },
    ),
  )
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = revisionsQuery
  const revisions = useMemo(
    () =>
      revisionsQuery.data?.pages.flatMap((page) => documentRevisionListFromApi(page).items) ?? [],
    [revisionsQuery.data],
  )
  const availableRevisions = useMemo(() => {
    const byRevision = new Map(revisions.map((revision) => [revision.revision, revision]))
    if (document.active) byRevision.set(document.active.revision, document.active)
    return [...byRevision.values()].sort((left, right) => right.revision - left.revision)
  }, [document.active, revisions])
  const requestedRevision =
    selectedRevision ?? initialDocumentRevision(document, availableRevisions)
  const revision = availableRevisions.find((candidate) => candidate.revision === requestedRevision)
  const effectiveRevision = revision?.revision

  useEffect(() => {
    if (
      selectedRevision === null ||
      revision ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    )
      return
    void fetchNextPage()
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    revision,
    selectedRevision,
  ])

  if (
    selectedRevision !== null &&
    !revision &&
    (revisionsQuery.isPending || isFetchingNextPage || hasNextPage)
  )
    return <RevisionLoadingState />

  if (selectedRevision !== null && !revision && revisionsQuery.error)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentRevisionsLoadError'])}
        onRetry={() => {
          if (isFetchNextPageError) void fetchNextPage()
          else void revisionsQuery.refetch()
        }}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
    )

  if (selectedRevision !== null && !revision)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  if (effectiveRevision === undefined && revisionsQuery.isPending) return <RevisionLoadingState />

  if (effectiveRevision === undefined && revisionsQuery.error)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        onRetry={() => void revisionsQuery.refetch()}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
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
    <>
      {revisionsQuery.error && !revisionsQuery.isFetchNextPageError && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentRevisionsLoadError'])}</span>
          <Button onClick={() => void revisionsQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      <DocumentRevisionData
        document={document}
        effectiveRevision={effectiveRevision}
        knowledgeSpaceId={knowledgeSpaceId}
        locale={locale}
        onSelectChunk={(chunkId) => void setDocumentLocation({ chunk: chunkId })}
        revision={revision}
        selectedChunkId={selectedChunkId ?? undefined}
      />
    </>
  )
}
