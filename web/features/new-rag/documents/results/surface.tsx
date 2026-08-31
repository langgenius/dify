'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { DocumentsEmpty, DocumentsList } from '../list'
import {
  DocumentPermissionRecoveryBoundary,
  DocumentReadPermissionRecovery,
} from '../permission-recovery/recovery-boundary'
import { responseStatus } from '../request-error'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import {
  documentsAtom,
  documentsQueryFetchNextPageAtom,
  documentsQueryRefetchAtom,
  sourcesQueryFetchNextPageAtom,
} from '../state/queries'
import {
  dependencyRecoveryFactsAtom,
  documentCollectionFactsAtom,
  documentQueryRecoveryNoticeFactsAtom,
  resultsAutoPaginationFactsAtom,
  retryDocumentDependenciesAtom,
} from '../state/recovery'
import { documentCanReadAtom } from '../state/runtime'
import { DocumentUploadSurface } from '../upload/surface'

function ResultsAutoPagination() {
  const canRead = useAtomValue(documentCanReadAtom)
  const { shouldFetchDocuments, shouldFetchSources } = useAtomValue(resultsAutoPaginationFactsAtom)
  const fetchNextDocumentPage = useAtomValue(documentsQueryFetchNextPageAtom)
  const fetchNextSourcePage = useAtomValue(sourcesQueryFetchNextPageAtom)

  useEffect(() => {
    if (canRead && shouldFetchDocuments) void fetchNextDocumentPage()
  }, [canRead, fetchNextDocumentPage, shouldFetchDocuments])

  useEffect(() => {
    if (canRead && shouldFetchSources) void fetchNextSourcePage()
  }, [canRead, fetchNextSourcePage, shouldFetchSources])

  return null
}

const DOCUMENT_RETRY_BUTTON_ID = 'documents-main-retry'
const DEPENDENCY_RETRY_BUTTON_ID = 'documents-dependency-retry'

function focusNextRecoveryTarget() {
  const target =
    document.getElementById(DOCUMENT_RETRY_BUTTON_ID) ??
    document.getElementById(DEPENDENCY_RETRY_BUTTON_ID) ??
    document.getElementById('new-knowledge-documents-title')
  target?.focus()
}

function DocumentQueryRecoveryNotice() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const canRead = useAtomValue(documentCanReadAtom)
  const retryFocusRequestedRef = useRef(false)
  const documentsRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentRecovery = useAtomValue(documentQueryRecoveryNoticeFactsAtom)
  const refetchDocuments = useAtomValue(documentsQueryRefetchAtom)

  useEffect(() => {
    if (!retryFocusRequestedRef.current) return
    if (documentRecovery.error && canRead) {
      documentsRetryButtonRef.current?.focus()
      return
    }
    retryFocusRequestedRef.current = false
    focusNextRecoveryTarget()
  }, [canRead, documentRecovery.error])

  if (
    !documentRecovery.error ||
    !documentRecovery.hasData ||
    !canRead ||
    documentRecovery.isFetchNextPageError
  )
    return null

  return (
    <div
      className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
      role="alert"
    >
      <span className="system-xs-regular text-text-tertiary">
        {t(($) =>
          responseStatus(documentRecovery.error) === 403
            ? $['newKnowledge.documentsPermissionDescription']
            : $['newKnowledge.documentsErrorDescription'],
        )}
      </span>
      {responseStatus(documentRecovery.error) !== 403 && (
        <Button
          id={DOCUMENT_RETRY_BUTTON_ID}
          ref={documentsRetryButtonRef}
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
          aria-busy={documentRecovery.isRefetching}
          loading={documentRecovery.isRefetching}
          size="small"
          onBlur={(event) => {
            if (event.relatedTarget) retryFocusRequestedRef.current = false
          }}
          onClick={() => {
            retryFocusRequestedRef.current = true
            void refetchDocuments()
          }}
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}

function DependencyRecoveryBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const canRead = useAtomValue(documentCanReadAtom)
  const retryFocusRequestedRef = useRef(false)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  const recovery = useAtomValue(dependencyRecoveryFactsAtom)
  const retry = useSetAtom(retryDocumentDependenciesAtom)
  const { blocking, retryFetching, sourceBlocking, taskBlocking, warning } = recovery
  const identity = [
    taskBlocking ? 'tasks-blocking' : '',
    sourceBlocking ? 'sources-blocking' : '',
    recovery.taskWarning ? 'tasks-warning' : '',
    recovery.sourceWarning ? 'sources-warning' : '',
  ].join(':')

  useEffect(() => {
    if (!retryFocusRequestedRef.current) return
    if (blocking || warning) {
      retryButtonRef.current?.focus()
      return
    }
    retryFocusRequestedRef.current = false
    focusNextRecoveryTarget()
  }, [blocking, identity, warning])

  if (!canRead) return children

  const sourceRecovery = recovery.sourceError || recovery.sourceIsFetchNextPageError
  const description = blocking
    ? taskBlocking
      ? t(($) => $['newKnowledge.tasksErrorDescription'])
      : t(($) => $['newKnowledge.sourcesErrorDescription'])
    : sourceRecovery
      ? t(($) => $['newKnowledge.sourcesErrorDescription'])
      : t(($) => $['newKnowledge.tasksErrorDescription'])

  return (
    <>
      {!blocking && warning && (
        <div
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
          role="alert"
        >
          <span className="system-xs-regular text-text-tertiary">{description}</span>
          <Button
            id={DEPENDENCY_RETRY_BUTTON_ID}
            ref={retryButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${description}`}
            aria-busy={retryFetching}
            loading={retryFetching}
            size="small"
            onBlur={(event) => {
              if (event.relatedTarget) retryFocusRequestedRef.current = false
            }}
            onClick={() => {
              retryFocusRequestedRef.current = true
              retry()
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      {blocking ? (
        <div
          className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
          <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
            {taskBlocking
              ? t(($) => $['newKnowledge.tasksErrorDescription'])
              : t(($) => $['newKnowledge.sourcesErrorDescription'])}
          </p>
          <Button
            id={DEPENDENCY_RETRY_BUTTON_ID}
            ref={retryButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${description}`}
            aria-busy={retryFetching}
            className="mt-4"
            loading={retryFetching}
            onBlur={(event) => {
              if (event.relatedTarget) retryFocusRequestedRef.current = false
            }}
            onClick={() => {
              retryFocusRequestedRef.current = true
              retry()
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : (
        children
      )}
    </>
  )
}

function DocumentCollectionState() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const canRead = useAtomValue(documentCanReadAtom)
  const documents = useAtomValue(documentsAtom)
  const recovery = useAtomValue(documentCollectionFactsAtom)
  const refetchDocuments = useAtomValue(documentsQueryRefetchAtom)
  const retryFocusRequestedRef = useRef(false)
  const retryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!retryFocusRequestedRef.current) return
    if (recovery.error && !recovery.hasData && canRead) {
      retryButtonRef.current?.focus()
      return
    }
    retryFocusRequestedRef.current = false
    focusNextRecoveryTarget()
  }, [canRead, recovery.error, recovery.hasData])

  if (recovery.isPending && canRead)
    return (
      <div className="flex min-h-64 flex-1 items-center justify-center">
        <Loading />
      </div>
    )
  if (!canRead) return <DocumentReadPermissionRecovery />
  if (recovery.error && !recovery.hasData)
    return (
      <div
        className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
        <h2 className="mt-3 title-xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.documentsErrorTitle'])}
        </h2>
        <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentsErrorDescription'])}
        </p>
        <Button
          id={DOCUMENT_RETRY_BUTTON_ID}
          ref={retryButtonRef}
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
          aria-busy={recovery.isFetching}
          className="mt-4"
          loading={recovery.isFetching}
          onBlur={(event) => {
            if (event.relatedTarget) retryFocusRequestedRef.current = false
          }}
          onClick={() => {
            retryFocusRequestedRef.current = true
            void refetchDocuments()
          }}
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </div>
    )
  return documents.length ? <DocumentsList /> : <DocumentsEmpty />
}

export function DocumentResultsSurface() {
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  return (
    <DocumentPermissionRecoveryBoundary>
      <DocumentUploadSurface>
        <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId={knowledgeSpaceId} />
        <ResultsAutoPagination />
        <DocumentQueryRecoveryNotice />
        <DependencyRecoveryBoundary>
          <DocumentCollectionState />
        </DependencyRecoveryBoundary>
      </DocumentUploadSurface>
    </DocumentPermissionRecoveryBoundary>
  )
}
