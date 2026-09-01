'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { DocumentRevisionData } from './revision-content'
import { documentDetailRequestedRevisionAtom } from './state/inputs'
import {
  documentDetailEffectiveRevisionAtom,
  documentDetailRevisionAtom,
  documentRevisionsQueryErrorAtom,
  documentRevisionsQueryHasNextPageAtom,
  documentRevisionsQueryIsFetchingNextPageAtom,
  documentRevisionsQueryIsFetchNextPageErrorAtom,
  documentRevisionsQueryIsPendingAtom,
  loadNextDocumentRevisionPageAtom,
  retryDocumentRevisionsAtom,
} from './state/revisions'

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
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const requestedRevision = useAtomValue(documentDetailRequestedRevisionAtom)
  const revision = useAtomValue(documentDetailRevisionAtom)
  const effectiveRevision = useAtomValue(documentDetailEffectiveRevisionAtom)
  const error = useAtomValue(documentRevisionsQueryErrorAtom)
  const hasNextPage = useAtomValue(documentRevisionsQueryHasNextPageAtom)
  const isFetchNextPageError = useAtomValue(documentRevisionsQueryIsFetchNextPageErrorAtom)
  const isFetchingNextPage = useAtomValue(documentRevisionsQueryIsFetchingNextPageAtom)
  const isPending = useAtomValue(documentRevisionsQueryIsPendingAtom)
  const loadNextPage = useSetAtom(loadNextDocumentRevisionPageAtom)
  const retryRevisions = useSetAtom(retryDocumentRevisionsAtom)

  useEffect(() => {
    if (
      requestedRevision === null ||
      revision ||
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
    requestedRevision,
    revision,
  ])

  if (requestedRevision !== null && !revision && (isPending || isFetchingNextPage || hasNextPage))
    return <RevisionLoadingState />

  if (requestedRevision !== null && !revision && error)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentRevisionsLoadError'])}
        onRetry={() => void retryRevisions()}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
    )

  if (requestedRevision !== null && !revision)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  if (effectiveRevision === undefined && isPending) return <RevisionLoadingState />

  if (effectiveRevision === undefined && error)
    return (
      <RevisionErrorState
        description={t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        onRetry={() => void retryRevisions()}
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
      {error && !isFetchNextPageError && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentRevisionsLoadError'])}</span>
          <Button onClick={() => void retryRevisions()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      <DocumentRevisionData />
    </>
  )
}
