'use client'

import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getHttpErrorStatus } from '@/service/http-error'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { DocumentsEmpty, DocumentsList } from '../list'
import {
  DocumentPermissionRecoveryBoundary,
  DocumentReadPermissionRecovery,
} from '../permission-recovery/recovery-boundary'
import { useRemoveDocumentAction } from '../row-actions/use-document-row-actions'
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
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const { shouldFetchDocuments, shouldFetchSources } = useAtomValueRawSync(
    resultsAutoPaginationFactsAtom,
  )
  const fetchNextDocumentPage = useAtomValueRawSync(documentsQueryFetchNextPageAtom)
  const fetchNextSourcePage = useAtomValueRawSync(sourcesQueryFetchNextPageAtom)

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
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const retryFocusRequestedRef = useRef(false)
  const documentsRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentRecovery = useAtomValueRawSync(documentQueryRecoveryNoticeFactsAtom)
  const refetchDocuments = useAtomValueRawSync(documentsQueryRefetchAtom)

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
          getHttpErrorStatus(documentRecovery.error) === 403
            ? $.documentsPermissionDescription
            : $.documentsErrorDescription,
        )}
      </span>
      {getHttpErrorStatus(documentRecovery.error) !== 403 && (
        <Button
          id={DOCUMENT_RETRY_BUTTON_ID}
          ref={documentsRetryButtonRef}
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $.documentsErrorDescription)}`}
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
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const retryFocusRequestedRef = useRef(false)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  const recovery = useAtomValueRawSync(dependencyRecoveryFactsAtom)
  const retry = useSetAtom(retryDocumentDependenciesAtom)
  const { blocking, retryFetching, sourceBlocking, warning } = recovery
  const identity = [
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
  const description =
    blocking || sourceRecovery
      ? t(($) => $.sourcesErrorDescription)
      : t(($) => $.tasksErrorDescription)

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
            {t(($) => $.sourcesErrorDescription)}
          </p>
          <Button
            id={DEPENDENCY_RETRY_BUTTON_ID}
            ref={retryButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${description}`}
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

function DocumentCollectionState({
  onRemove,
}: {
  onRemove: (documentId: string, row: HTMLTableRowElement | null) => void
}) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const { t: tCommon } = useTranslation(['common'])
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const documents = useAtomValueRawSync(documentsAtom)
  const recovery = useAtomValueRawSync(documentCollectionFactsAtom)
  const refetchDocuments = useAtomValueRawSync(documentsQueryRefetchAtom)
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
        <LoadingPlaceholder />
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
          {t(($) => $.documentsErrorTitle, { ns: 'knowledgeDocuments' })}
        </h2>
        <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
          {t(($) => $.documentsErrorDescription)}
        </p>
        <Button
          id={DOCUMENT_RETRY_BUTTON_ID}
          ref={retryButtonRef}
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $.documentsErrorDescription)}`}
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
  return documents.length ? <DocumentsList onRemove={onRemove} /> : <DocumentsEmpty />
}

export function DocumentResultsSurface() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const listRef = useRef<HTMLDivElement>(null)
  const [deleteDialog] = useState(() =>
    createAlertDialogHandle<{
      documentId: string
      adjacentFocusTargets: HTMLElement[]
      fallbackFocus: { current: HTMLElement | null }
    }>(),
  )
  const { pending: deleting, run: removeDocument, reset } = useRemoveDocumentAction()

  const knowledgeSpaceId = useAtomValueRawSync(documentsKnowledgeSpaceIdAtom)
  return (
    <div
      ref={listRef}
      tabIndex={-1}
      role="region"
      aria-label={t(($) => $.documents)}
      className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-state-accent-solid"
    >
      <DocumentPermissionRecoveryBoundary>
        <DocumentUploadSurface>
          <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId={knowledgeSpaceId} />
          <ResultsAutoPagination />
          <DocumentQueryRecoveryNotice />
          <DependencyRecoveryBoundary>
            <DocumentCollectionState
              onRemove={(documentId, row) => {
                const adjacentFocusTargets = getAdjacentFocusTargets(row, (sibling) =>
                  sibling.querySelector<HTMLAnchorElement>('a[href]'),
                )
                deleteDialog.openWithPayload({
                  documentId,
                  adjacentFocusTargets,
                  fallbackFocus: { current: null },
                })
              }}
            />
          </DependencyRecoveryBoundary>
        </DocumentUploadSurface>
      </DocumentPermissionRecoveryBoundary>
      <AlertDialog
        handle={deleteDialog}
        onOpenChange={(open, details) => {
          if (!open && deleting && details.reason !== 'imperative-action') details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) reset()
        }}
      >
        {({ payload }) => (
          <AlertDialogContent
            finalFocus={() => {
              const fallback = payload?.fallbackFocus.current
              if (!fallback) return true
              const target =
                payload.adjacentFocusTargets.find((element) => element.isConnected) ?? fallback
              target.focus({ preventScroll: true })
              return false
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tCommon(($) => $['operation.deleteConfirmTitle'])}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {tCommon(($) => $['operation.confirmAction'])}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={deleting}>
                {tCommon(($) => $['operation.cancel'])}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                loading={deleting}
                tone="destructive"
                onClick={async () => {
                  if (!payload || deleting) return
                  if (await removeDocument(payload.documentId)) {
                    payload.fallbackFocus.current = listRef.current
                    deleteDialog.close()
                  }
                }}
              >
                {tCommon(($) => $['operation.delete'])}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  )
}
