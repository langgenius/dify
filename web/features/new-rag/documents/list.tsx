'use client'

import type { DocumentDisplayStatus } from './model'
import type { LogicalDocument } from './models'
import type { DocumentFilter } from './query-state'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { DocumentActionsDropdown } from './actions-dropdown'
import { DocumentBulkActionsToolbar } from './bulk/toolbar'
import { DocumentPermissionRecoveryBulkRegion } from './permission-recovery/recovery-boundary'
import {
  documentFilterParser,
  documentMetadataParser,
  documentSearchParser,
  documentUploadParser,
} from './query-state'
import { documentsKnowledgeSpaceIdAtom } from './state/inputs'
import { documentsQueryFetchNextPageAtom, sourcesQueryFetchNextPageAtom } from './state/queries'
import {
  createDocumentRowSourceFactsAtom,
  createDocumentRowStatusFactsAtom,
  documentListPaginationAtom,
  documentRenderWindowIdentityAtom,
  documentsToolbarFactsAtom,
  documentTableContentFactsAtom,
  taskTriggerFactsAtom,
} from './state/results'
import { documentCanWriteAtom } from './state/runtime'
import { documentTasksOpenAtom } from './state/scoped'
import {
  createDocumentRowSelectionFactsAtom,
  documentTableSelectionFactsAtom,
  toggleAllFilteredDocumentsAtom,
  toggleDocumentSelectionAtom,
} from './state/selection'
import { documentUploadAvailability, documentUploadingAtom } from './state/upload'

const DOCUMENT_RENDER_BATCH_SIZE = 100
const PARTIAL_RESULTS_DESCRIPTION_ID = 'partial-document-results'

const statusIconClass: Record<DocumentDisplayStatus, string> = {
  ready: 'i-ri-check-line text-text-success',
  queued: 'i-ri-time-line text-text-tertiary',
  processing: 'i-ri-loader-2-line animate-spin text-text-accent motion-reduce:animate-none',
  failed: 'i-ri-error-warning-fill text-text-destructive',
  disabled: 'i-ri-indeterminate-circle-line text-text-tertiary',
}

const statusTextClass: Record<DocumentDisplayStatus, string> = {
  ready: 'font-normal text-text-secondary',
  queued: 'font-normal text-text-tertiary',
  processing: 'font-medium text-text-accent',
  failed: 'font-medium text-text-destructive',
  disabled: 'font-medium text-text-tertiary',
}

function DocumentStatus({
  failureReason,
  status,
}: {
  failureReason?: string
  status: DocumentDisplayStatus
}) {
  const { t } = useTranslation('dataset')
  const statusLabel = t(($) => $[`newKnowledge.documentStatus.${status}`])
  const content = (
    <>
      <span
        aria-hidden
        className={cn(status === 'processing' ? 'size-4' : 'size-3.5', statusIconClass[status])}
      />
      {statusLabel}
    </>
  )
  const className = cn(
    'inline-flex items-center gap-1.5 text-xs leading-4',
    statusTextClass[status],
  )

  if (status !== 'failed' || !failureReason) return <span className={className}>{content}</span>

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            aria-label={`${statusLabel}: ${failureReason}`}
            className={cn(
              className,
              'rounded-sm text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            )}
          >
            {content}
          </button>
        }
      />
      <PopoverContent placement="top" className="max-w-80 px-3 py-2">
        <PopoverDescription className="system-xs-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
          {failureReason}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}

function TaskTrigger() {
  const { t } = useTranslation('dataset')
  const setTasksOpen = useSetAtom(documentTasksOpenAtom)
  const { activeTaskCount, attentionTaskCount, hasTaskError, historyIncomplete } =
    useAtomValue(taskTriggerFactsAtom)
  const incompleteTaskHistoryHint = historyIncomplete
    ? ` · ${t(($) => $['newKnowledge.taskHistoryIncomplete'])}`
    : ''
  const attentionTaskBadge =
    attentionTaskCount || historyIncomplete
      ? `${attentionTaskCount}${historyIncomplete ? '+' : ''}`
      : undefined
  const tasksButtonLabel = `${
    attentionTaskCount || historyIncomplete
      ? t(($) => $['newKnowledge.tasksWithAttention'], { count: attentionTaskCount })
      : t(($) => $['newKnowledge.tasks'])
  }${incompleteTaskHistoryHint}`
  const tasksLiveStatus = `${
    hasTaskError
      ? t(($) => $['newKnowledge.taskAttentionErrorCount'], { count: attentionTaskCount })
      : attentionTaskCount || historyIncomplete
        ? t(($) => $['newKnowledge.taskAttentionCount'], { count: attentionTaskCount })
        : t(($) => $['newKnowledge.taskAttentionClear'])
  }${incompleteTaskHistoryHint}`

  return (
    <>
      <Button
        aria-label={tasksButtonLabel}
        className="gap-1 pl-3"
        data-has-error={hasTaskError}
        onClick={() => setTasksOpen(true)}
      >
        <span
          aria-hidden
          className={cn(
            'size-4',
            activeTaskCount ? 'i-ri-loader-2-line animate-spin' : 'i-ri-task-line',
            activeTaskCount && 'motion-reduce:animate-none',
          )}
        />
        {t(($) => $['newKnowledge.tasks'])}
        {attentionTaskBadge && (
          <span
            aria-hidden
            className={cn(
              'flex min-w-4 items-center justify-center rounded px-1 system-2xs-medium',
              hasTaskError
                ? 'bg-state-destructive-hover text-text-destructive'
                : 'bg-state-accent-hover text-text-accent',
            )}
          >
            {attentionTaskBadge}
          </span>
        )}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {tasksLiveStatus}
      </span>
    </>
  )
}

function DocumentSelectionCell({ document }: { document: LogicalDocument }) {
  const selectionFactsAtom = useMemo(
    () => createDocumentRowSelectionFactsAtom(document.id),
    [document.id],
  )
  const { canWrite, readOnlyReasonId, resultsIncomplete, selected, selectionDisabled } =
    useAtomValue(selectionFactsAtom)
  const onSelectedChange = useSetAtom(toggleDocumentSelectionAtom)
  const titleId = `new-document-${document.id}`

  return (
    <td className="w-10 align-middle">
      <Checkbox
        className="flex"
        checked={selected}
        disabled={selectionDisabled || document.status === 'deleting'}
        aria-describedby={
          selectionDisabled
            ? canWrite
              ? resultsIncomplete
                ? PARTIAL_RESULTS_DESCRIPTION_ID
                : undefined
              : readOnlyReasonId
            : undefined
        }
        aria-labelledby={titleId}
        onCheckedChange={() => onSelectedChange(document.id)}
      />
    </td>
  )
}

function DocumentTitleCell({ document }: { document: LogicalDocument }) {
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const documentHref = newKnowledgeDocumentDetailPath(knowledgeSpaceId, document.id)
  const revision = document.activeRevision ?? document.active?.revision

  return (
    <td className="min-w-0 pr-3 align-middle sm:min-w-72 sm:pr-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="i-ri-file-text-line size-4.5 shrink-0 text-text-tertiary" />
        <Link
          id={`new-document-${document.id}`}
          className="truncate rounded text-[13px] leading-4.25 font-medium text-text-primary hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          href={documentHref}
        >
          {document.title}
        </Link>
        {revision !== undefined && (
          <span className="flex min-h-4 min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-regular px-1 system-2xs-medium text-text-tertiary">
            v{revision}
          </span>
        )}
      </div>
    </td>
  )
}

function DocumentSourceCell({ documentId }: { documentId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const sourceFactsAtom = useMemo(() => createDocumentRowSourceFactsAtom(documentId), [documentId])
  const { pending, source } = useAtomValue(sourceFactsAtom)

  return (
    <td className="hidden w-58.5 pr-6 align-middle system-xs-regular text-text-secondary lg:table-cell">
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-24 animate-pulse rounded bg-background-section motion-reduce:animate-none"
          />
          <span className="sr-only">{tCommon(($) => $.loading)}</span>
        </span>
      ) : (
        <span className="block truncate">{source ?? t(($) => $['newKnowledge.manualUpload'])}</span>
      )}
    </td>
  )
}

function DocumentStatusCell({ documentId }: { documentId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const statusFactsAtom = useMemo(() => createDocumentRowStatusFactsAtom(documentId), [documentId])
  const { failureMessageKey, status, statusPending } = useAtomValue(statusFactsAtom)
  const failureReason = failureMessageKey ? t(($) => $[failureMessageKey]) : undefined

  return (
    <td className="w-24 pr-2 align-middle sm:w-66 sm:pr-6">
      {statusPending ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-20 animate-pulse rounded bg-background-section motion-reduce:animate-none"
          />
          <span className="sr-only">{tCommon(($) => $.loading)}</span>
        </span>
      ) : (
        <DocumentStatus failureReason={failureReason} status={status} />
      )}
    </td>
  )
}

function DocumentUpdatedCell({ updatedAt }: { updatedAt: string }) {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const updatedTime = Date.parse(updatedAt)
  return (
    <td className="hidden w-43.5 pr-6 align-middle system-xs-regular text-text-tertiary lg:table-cell">
      {Number.isNaN(updatedTime) ? updatedAt : formatTimeFromNow(updatedTime)}
    </td>
  )
}

const DocumentRow = memo(({ document }: { document: LogicalDocument }) => (
  <tr className="h-12 border-t border-divider-subtle">
    <DocumentSelectionCell document={document} />
    <DocumentTitleCell document={document} />
    <DocumentSourceCell documentId={document.id} />
    <DocumentStatusCell documentId={document.id} />
    <DocumentUpdatedCell updatedAt={document.updatedAt} />
    <td className="w-10 align-middle">
      <DocumentActionsDropdown document={document} />
    </td>
  </tr>
))

export function DocumentsEmpty() {
  const { t } = useTranslation('dataset')
  const [_metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const [_uploadRequest, setUploadRequest] = useQueryState('upload', documentUploadParser)
  const canWrite = useAtomValue(documentCanWriteAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const uploading = useAtomValue(documentUploadingAtom)
  const { canUpload, restrictionReasonId: uploadRestrictionReasonId } = documentUploadAvailability(
    canWrite,
    uploadAvailable,
  )

  return (
    <div className="flex min-h-96 flex-1 flex-col items-center justify-center gap-4 overflow-clip p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-background-section text-text-accent">
        <span aria-hidden className="i-ri-file-text-fill size-6" />
      </span>
      <h2 className="text-base leading-[normal] font-semibold text-text-primary">
        {t(($) => $['newKnowledge.documentsEmptyTitle'])}
      </h2>
      <p className="w-115 max-w-full text-[13px] leading-4 font-normal text-text-tertiary">
        {t(($) => $['newKnowledge.documentsEmptyDescription'])}
      </p>
      <div className="flex items-center gap-2">
        <Button className="gap-1 pl-3" onClick={() => void setMetadataRequest('1')}>
          <span aria-hidden className="i-ri-file-text-line size-4" />
          {t(($) => $['newKnowledge.metadata'])}
        </Button>
        <Button
          className="gap-1 pl-3"
          variant="primary"
          aria-busy={uploading}
          disabled={!canUpload}
          loading={uploading}
          aria-describedby={!canUpload ? uploadRestrictionReasonId : undefined}
          onClick={() => void setUploadRequest('1')}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addDocument'])}
        </Button>
      </div>
      {canUpload && (
        <p className="system-xs-regular text-text-quaternary">
          {t(($) => $['newKnowledge.documentsDropHint'])}
        </p>
      )}
    </div>
  )
}

function DocumentsToolbar() {
  const { t } = useTranslation('dataset')
  const [filter, setFilter] = useQueryState('status', documentFilterParser)
  const [search, setSearch] = useQueryState('query', documentSearchParser)
  const [_metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const [_uploadRequest, setUploadRequest] = useQueryState('upload', documentUploadParser)
  const { showTasks, statusPending } = useAtomValue(documentsToolbarFactsAtom)
  const canWrite = useAtomValue(documentCanWriteAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const uploading = useAtomValue(documentUploadingAtom)
  const { canUpload, restrictionReasonId: uploadRestrictionReasonId } = documentUploadAvailability(
    canWrite,
    uploadAvailable,
  )

  return (
    <div className="mt-4.5 flex flex-col gap-2 @min-[768px]/knowledge-content:flex-row @min-[768px]/knowledge-content:items-center">
      <Select<DocumentFilter>
        disabled={statusPending}
        value={filter}
        onValueChange={(value) => {
          if (value) void setFilter(value)
        }}
      >
        <SelectLabel className="sr-only">
          {t(($) => $['newKnowledge.documentFilterLabel'])}
        </SelectLabel>
        <SelectTrigger className="@min-[768px]/knowledge-content:w-35">
          {filter === 'all'
            ? t(($) => $['newKnowledge.allDocumentStatuses'])
            : t(($) => $[`newKnowledge.documentStatus.${filter}`])}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <SelectItemText>{t(($) => $['newKnowledge.allDocumentStatuses'])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          {(['ready', 'queued', 'processing', 'failed', 'disabled'] as const).map((status) => (
            <SelectItem key={status} value={status}>
              <SelectItemText>
                {t(($) => $[`newKnowledge.documentStatus.${status}`])}
              </SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SearchInput
        aria-label={t(($) => $['newKnowledge.searchDocuments'])}
        className="@min-[768px]/knowledge-content:w-60"
        value={search}
        onValueChange={(value) => void setSearch(value)}
        placeholder={t(($) => $['newKnowledge.searchDocuments'])}
      />
      <span className="min-w-0 flex-1" />
      {showTasks && <TaskTrigger />}
      <Button className="gap-1 pl-3" onClick={() => void setMetadataRequest('1')}>
        <span aria-hidden className="i-ri-file-text-line size-4" />
        {t(($) => $['newKnowledge.metadata'])}
      </Button>
      <Button
        className="gap-1 pl-3"
        variant="primary"
        aria-busy={uploading}
        disabled={!canUpload}
        loading={uploading}
        aria-describedby={!canUpload ? uploadRestrictionReasonId : undefined}
        onClick={() => void setUploadRequest('1')}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['newKnowledge.addDocument'])}
      </Button>
    </div>
  )
}

function DocumentsTableHeader() {
  const { t } = useTranslation('dataset')
  const {
    allSelected,
    canWrite,
    hasSelectableDocuments,
    readOnlyReasonId,
    resultsIncomplete,
    selectionDisabled,
    someSelected,
  } = useAtomValue(documentTableSelectionFactsAtom)
  const toggleAllFilteredDocuments = useSetAtom(toggleAllFilteredDocumentsAtom)

  return (
    <thead className="system-xs-regular text-text-tertiary">
      <tr>
        <th className="py-2 font-normal">
          <Checkbox
            className="flex"
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            disabled={selectionDisabled || !hasSelectableDocuments}
            aria-describedby={
              !canWrite
                ? readOnlyReasonId
                : selectionDisabled && resultsIncomplete
                  ? PARTIAL_RESULTS_DESCRIPTION_ID
                  : undefined
            }
            aria-label={t(($) => $['newKnowledge.selectAllDocuments'])}
            onCheckedChange={() => {
              if (!selectionDisabled) toggleAllFilteredDocuments()
            }}
          />
        </th>
        <th className="py-2 pr-6 font-normal">{t(($) => $['newKnowledge.documentColumn'])}</th>
        <th className="hidden w-58.5 py-2 pr-6 font-normal lg:table-cell">
          {t(($) => $['newKnowledge.sourceColumn'])}
        </th>
        <th className="w-24 py-2 pr-2 font-normal sm:w-66 sm:pr-6">
          {t(($) => $['newKnowledge.statusColumn'])}
        </th>
        <th className="hidden w-43.5 py-2 pr-6 font-normal lg:table-cell">
          {t(($) => $['newKnowledge.updatedColumn'])}
        </th>
        <th
          className="w-10 py-2 font-normal"
          aria-label={t(($) => $['newKnowledge.actionsColumn'])}
        />
      </tr>
    </thead>
  )
}

function DocumentsTable() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { documents, resultsIncomplete, sourcesPending, tasksPending } = useAtomValue(
    documentTableContentFactsAtom,
  )
  const renderWindowKey = useAtomValue(documentRenderWindowIdentityAtom)
  const {
    completingResults,
    filterActive,
    hasNextDocumentPage,
    hasNextPage,
    hasRelevantNextSourcePage,
    isFetchingNextDocumentPage,
    isFetchingNextPage,
    isFetchingNextSourcePage,
    isFetchNextPageError,
  } = useAtomValue(documentListPaginationAtom)
  const fetchNextDocumentPage = useAtomValue(documentsQueryFetchNextPageAtom)
  const fetchNextSourcePage = useAtomValue(sourcesQueryFetchNextPageAtom)
  const [renderWindow, setRenderWindow] = useState({
    key: renderWindowKey,
    limit: DOCUMENT_RENDER_BATCH_SIZE,
  })
  if (renderWindow.key !== renderWindowKey)
    setRenderWindow({ key: renderWindowKey, limit: DOCUMENT_RENDER_BATCH_SIZE })
  const visibleDocumentLimit =
    renderWindow.key === renderWindowKey ? renderWindow.limit : DOCUMENT_RENDER_BATCH_SIZE
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const resultsContainerRef = useRef<HTMLDivElement>(null)
  const restoreLoadMoreFocusRef = useRef(false)
  const visibleDocuments = documents.slice(0, visibleDocumentLimit)
  const hasHiddenDocuments = visibleDocuments.length < documents.length

  useEffect(() => {
    if (isFetchingNextPage || !restoreLoadMoreFocusRef.current) return
    if (hasHiddenDocuments || hasNextPage || isFetchNextPageError) {
      loadMoreButtonRef.current?.focus()
      return
    }
    restoreLoadMoreFocusRef.current = false
    resultsContainerRef.current?.focus()
  }, [hasHiddenDocuments, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  const loadMoreResults = () => {
    const requests: Promise<unknown>[] = []
    if (hasNextDocumentPage && !isFetchingNextDocumentPage) requests.push(fetchNextDocumentPage())
    if (hasRelevantNextSourcePage && !isFetchingNextSourcePage) requests.push(fetchNextSourcePage())
    void Promise.allSettled(requests)
  }

  return (
    <>
      <div
        ref={resultsContainerRef}
        aria-labelledby="new-knowledge-documents-title"
        aria-busy={completingResults || isFetchingNextPage || sourcesPending || tasksPending}
        className="mt-3 overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        role="region"
        tabIndex={-1}
      >
        <table className="w-full table-fixed border-collapse text-left lg:table-auto">
          <DocumentsTableHeader />
          <tbody>
            {visibleDocuments.map((document) => (
              <DocumentRow key={document.id} document={document} />
            ))}
          </tbody>
        </table>
        {!documents.length && !completingResults && !isFetchNextPageError && !resultsIncomplete && (
          <p
            aria-live="polite"
            className="py-16 text-center body-sm-regular text-text-tertiary"
            role="status"
          >
            {t(($) => $['newKnowledge.noMatchingDocuments'])}
          </p>
        )}
        {resultsIncomplete && (
          <p
            id={PARTIAL_RESULTS_DESCRIPTION_ID}
            aria-live="polite"
            className={cn(
              'text-center body-sm-regular text-text-tertiary',
              completingResults || isFetchNextPageError
                ? 'sr-only'
                : documents.length
                  ? 'py-4'
                  : 'py-16',
            )}
            role="status"
          >
            {t(($) => $['newKnowledge.partialDocumentResults'])}
          </p>
        )}
        {completingResults && (
          <div className="flex min-h-32 items-center justify-center">
            <Loading />
          </div>
        )}
      </div>
      {hasHiddenDocuments ? (
        <div className="mt-5 flex justify-center">
          <Button
            ref={loadMoreButtonRef}
            onBlur={() => {
              restoreLoadMoreFocusRef.current = false
            }}
            onClick={() => {
              restoreLoadMoreFocusRef.current = document.activeElement === loadMoreButtonRef.current
              setRenderWindow((current) => ({
                ...current,
                limit: current.limit + DOCUMENT_RENDER_BATCH_SIZE,
              }))
            }}
          >
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      ) : isFetchNextPageError ? (
        <div className="mt-5 flex items-center justify-center gap-3" role="alert">
          <span className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.documentsErrorDescription'])}
          </span>
          <Button
            ref={loadMoreButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
            aria-busy={isFetchingNextDocumentPage}
            loading={isFetchingNextDocumentPage}
            onBlur={(event) => {
              if (event.relatedTarget) restoreLoadMoreFocusRef.current = false
            }}
            onClick={() => {
              restoreLoadMoreFocusRef.current = document.activeElement === loadMoreButtonRef.current
              loadMoreResults()
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : hasNextPage && (!filterActive || !completingResults) ? (
        <div className="mt-5 flex justify-center">
          <Button
            ref={loadMoreButtonRef}
            aria-busy={isFetchingNextPage}
            loading={isFetchingNextPage}
            onBlur={(event) => {
              if (event.relatedTarget) restoreLoadMoreFocusRef.current = false
            }}
            onClick={() => {
              restoreLoadMoreFocusRef.current = document.activeElement === loadMoreButtonRef.current
              loadMoreResults()
            }}
          >
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function DocumentsList() {
  const { t } = useTranslation('dataset')

  return (
    <>
      <div className="min-w-0">
        <DocumentsToolbar />
        <DocumentsTable />
      </div>
      <p className="flex min-h-4 items-center gap-1.5 system-xs-regular text-text-tertiary">
        <span aria-hidden className="i-ri-information-2-line size-3.5" />
        {t(($) => $['newKnowledge.lastReadyRevisionHint'])}
      </p>
      <DocumentPermissionRecoveryBulkRegion>
        <DocumentBulkActionsToolbar />
      </DocumentPermissionRecoveryBulkRegion>
    </>
  )
}

export function DocumentDropOverlay({ fileSizeLimitMb }: { fileSizeLimitMb: number }) {
  const { t } = useTranslation('dataset')

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-divider-regular bg-[rgba(255,255,255,0.5)] text-center backdrop-blur-[5px]"
      role="status"
    >
      <div className="flex h-22 w-57 items-center justify-center gap-2 rounded-xl border border-dashed border-divider-regular bg-components-panel-bg shadow-xs">
        <span aria-hidden className="i-ri-file-word-2-fill size-6 text-text-accent" />
        <span aria-hidden className="i-ri-file-pdf-2-fill size-6 text-text-destructive" />
        <span aria-hidden className="i-ri-file-excel-fill size-6 text-text-success" />
        <span aria-hidden className="i-ri-file-text-fill size-6 text-text-tertiary" />
      </div>
      <p className="mt-4 system-md-semibold text-text-primary">
        {t(($) => $['newKnowledge.dropFilesHere'])}
      </p>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.documentUploadFormats'], { size: fileSizeLimitMb })}
      </p>
    </div>
  )
}
