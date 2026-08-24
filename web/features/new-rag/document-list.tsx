'use client'

import type { FocusEventHandler } from 'react'
import type { DocumentAction } from './document-actions-dropdown'
import type { DocumentDisplayStatus } from './document-model'
import type { LogicalDocument } from './document-models'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
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
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { DocumentActionsDropdown } from './document-actions-dropdown'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentShowsAvailabilityAction,
  sourceName,
} from './document-model'

export type DocumentFilter = DocumentDisplayStatus | 'all'

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

function TaskTrigger({
  activeTaskCount,
  attentionTaskBadge,
  hasTaskError,
  onOpenTasks,
  tasksButtonLabel,
  tasksLiveStatus,
}: {
  activeTaskCount: number
  attentionTaskBadge?: string
  hasTaskError: boolean
  onOpenTasks: () => void
  tasksButtonLabel: string
  tasksLiveStatus: string
}) {
  const { t } = useTranslation('dataset')
  return (
    <>
      <Button
        aria-label={tasksButtonLabel}
        className="gap-1 pl-3"
        data-has-error={hasTaskError}
        onClick={onOpenTasks}
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

const DocumentRow = memo(
  ({
    document,
    documentHref,
    failureReason,
    formatTimeFromNow,
    canDownload,
    onDownload,
    onRemove,
    onRename,
    onSelectedChange,
    onReindex,
    onRetry,
    onToggleAvailability,
    pendingAction,
    readOnlyReasonId,
    retryable,
    selected,
    selectionDisabled,
    source,
    sourcePending,
    status,
    statusPending,
    tasksPending,
  }: {
    canDownload: boolean
    document: LogicalDocument
    documentHref: string
    failureReason?: string
    formatTimeFromNow: (time: number) => string
    onDownload: (documentId: string) => Promise<boolean>
    onRemove: (documentId: string) => Promise<boolean>
    onRename: (documentId: string, title: string) => Promise<boolean>
    onSelectedChange: (documentId: string) => void
    onReindex: (documentId: string) => void
    onRetry: (documentId: string) => Promise<boolean>
    onToggleAvailability: (documentId: string) => Promise<boolean>
    pendingAction?: DocumentAction
    readOnlyReasonId?: string
    retryable: boolean
    selected: boolean
    selectionDisabled: boolean
    source?: string
    sourcePending: boolean
    status: DocumentDisplayStatus
    statusPending: boolean
    tasksPending: boolean
  }) => {
    const { t } = useTranslation('dataset')
    const { t: tCommon } = useTranslation('common')
    const titleId = `new-document-${document.id}`
    const revision = document.activeRevision ?? document.active?.revision
    const updatedTime = Date.parse(document.updatedAt)

    return (
      <tr className="h-12 border-t border-divider-subtle">
        <td className="w-10 align-middle">
          <Checkbox
            className="flex"
            checked={selected}
            disabled={selectionDisabled || document.status === 'deleting'}
            aria-describedby={selectionDisabled ? readOnlyReasonId : undefined}
            aria-labelledby={titleId}
            onCheckedChange={() => onSelectedChange(document.id)}
          />
        </td>
        <td className="min-w-0 pr-3 align-middle sm:min-w-72 sm:pr-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="i-ri-file-text-line size-4.5 shrink-0 text-text-tertiary"
            />
            <Link
              id={titleId}
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
        <td className="hidden w-58.5 pr-6 align-middle system-xs-regular text-text-secondary lg:table-cell">
          {sourcePending ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="h-3 w-24 animate-pulse rounded bg-background-section motion-reduce:animate-none"
              />
              <span className="sr-only">{tCommon(($) => $.loading)}</span>
            </span>
          ) : (
            <span className="block truncate">
              {source ?? t(($) => $['newKnowledge.manualUpload'])}
            </span>
          )}
        </td>
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
        <td className="hidden w-43.5 pr-6 align-middle system-xs-regular text-text-tertiary lg:table-cell">
          {Number.isNaN(updatedTime) ? document.updatedAt : formatTimeFromNow(updatedTime)}
        </td>
        <td className="w-10 align-middle">
          <DocumentActionsDropdown
            canDownload={canDownload}
            canEdit={!selectionDisabled}
            documentEnabled={document.enabled}
            documentTitle={document.title}
            downloadDisabled={tasksPending || !documentCanDownload(document, status)}
            onDownload={() => onDownload(document.id)}
            onRemove={() => onRemove(document.id)}
            onRename={(title) => onRename(document.id, title)}
            onReindex={() => onReindex(document.id)}
            onRetry={() => onRetry(document.id)}
            onToggleAvailability={() => onToggleAvailability(document.id)}
            pendingAction={pendingAction}
            removeDisabled={document.status === 'deleting'}
            reindexDisabled={selectionDisabled || !documentCanReindex(status)}
            retryDisabled={selectionDisabled || !retryable}
            showAvailabilityAction={documentShowsAvailabilityAction(status)}
            showRetry={status === 'failed'}
            toggleAvailabilityDisabled={
              selectionDisabled ||
              document.status === 'deleting' ||
              !documentCanToggleAvailability(status)
            }
            unavailableReasonId={`${titleId}-actions-unavailable`}
          />
        </td>
      </tr>
    )
  },
)

export function DocumentsEmpty({
  canEdit,
  onAddDocument,
  onOpenMetadata,
  readOnlyReasonId,
  uploading,
}: {
  canEdit: boolean
  onAddDocument: () => void
  onOpenMetadata: () => void
  readOnlyReasonId?: string
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')

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
        <Button className="gap-1 pl-3" onClick={onOpenMetadata}>
          <span aria-hidden className="i-ri-file-text-line size-4" />
          {t(($) => $['newKnowledge.metadata'])}
        </Button>
        <Button
          className="gap-1 pl-3"
          variant="primary"
          aria-busy={uploading}
          disabled={!canEdit}
          loading={uploading}
          aria-describedby={!canEdit ? readOnlyReasonId : undefined}
          onClick={onAddDocument}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addDocument'])}
        </Button>
      </div>
      {canEdit && (
        <p className="system-xs-regular text-text-quaternary">
          {t(($) => $['newKnowledge.documentsDropHint'])}
        </p>
      )}
    </div>
  )
}

export function DocumentsList({
  activeTaskCount,
  allSelected,
  attentionTaskBadge,
  canDownload,
  canEdit,
  canUpload,
  completingResults,
  documents,
  failureReasons,
  filter,
  getDocumentHref,
  hasNextPage,
  hasSelectableDocuments,
  hasTaskError,
  isFetchNextPageError,
  isFetchingNextDocumentPage,
  isFetchingNextPage,
  onAddDocument,
  onFilterChange,
  onLoadMore,
  onDownloadDocument,
  onOpenMetadata,
  onOpenTasks,
  onRemoveDocument,
  onRenameDocument,
  onReindexDocument,
  onRetryDocument,
  onSearchChange,
  onSelectAll,
  onSelectDocument,
  onToggleDocumentAvailability,
  pendingDocumentAction,
  readOnlyReasonId,
  resultsIncomplete,
  retryableDocumentIds,
  search,
  selectionDisabled,
  selectedDocumentIds,
  showTasks,
  someSelected,
  sourcesPending,
  sourceNames,
  statusPending,
  statuses,
  tasksPending,
  tasksButtonLabel,
  tasksLiveStatus,
  uploadRestrictionReasonId,
  uploading,
}: {
  activeTaskCount: number
  allSelected: boolean
  attentionTaskBadge?: string
  canDownload: boolean
  canEdit: boolean
  canUpload: boolean
  completingResults: boolean
  documents: LogicalDocument[]
  failureReasons: Map<string, string>
  filter: DocumentFilter
  getDocumentHref: (documentId: string) => string
  hasNextPage: boolean
  hasSelectableDocuments: boolean
  hasTaskError: boolean
  isFetchNextPageError: boolean
  isFetchingNextDocumentPage: boolean
  isFetchingNextPage: boolean
  onAddDocument: () => void
  onFilterChange: (filter: DocumentFilter) => void
  onLoadMore: () => void
  onDownloadDocument: (documentId: string) => Promise<boolean>
  onOpenMetadata: () => void
  onOpenTasks: () => void
  onRemoveDocument: (documentId: string) => Promise<boolean>
  onRenameDocument: (documentId: string, title: string) => Promise<boolean>
  onReindexDocument: (documentId: string) => void
  onRetryDocument: (documentId: string) => Promise<boolean>
  onSearchChange: (search: string) => void
  onSelectAll: () => void
  onSelectDocument: (documentId: string) => void
  onToggleDocumentAvailability: (documentId: string) => Promise<boolean>
  pendingDocumentAction?: { action: DocumentAction; documentId: string }
  readOnlyReasonId?: string
  resultsIncomplete: boolean
  retryableDocumentIds: Set<string>
  search: string
  selectionDisabled: boolean
  selectedDocumentIds: Set<string>
  showTasks: boolean
  someSelected: boolean
  sourcesPending: boolean
  sourceNames: Map<string, string>
  statusPending: boolean
  statuses: Map<string, DocumentDisplayStatus>
  tasksPending: boolean
  tasksButtonLabel: string
  tasksLiveStatus: string
  uploadRestrictionReasonId?: string
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [visibleDocumentLimit, setVisibleDocumentLimit] = useState(DOCUMENT_RENDER_BATCH_SIZE)
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const resultsContainerRef = useRef<HTMLDivElement>(null)
  const restoreLoadMoreFocusRef = useRef(false)
  const filterActive = filter !== 'all' || Boolean(search.trim())
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

  return (
    <>
      <div className="min-w-0">
        <div className="mt-4.5 flex flex-col gap-2 @min-[768px]/knowledge-content:flex-row @min-[768px]/knowledge-content:items-center">
          <Select<DocumentFilter>
            disabled={statusPending}
            value={filter}
            onValueChange={(value) => {
              if (!value) return
              setVisibleDocumentLimit(DOCUMENT_RENDER_BATCH_SIZE)
              onFilterChange(value)
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
            onValueChange={(value) => {
              setVisibleDocumentLimit(DOCUMENT_RENDER_BATCH_SIZE)
              onSearchChange(value)
            }}
            placeholder={t(($) => $['newKnowledge.searchDocuments'])}
          />
          <span className="min-w-0 flex-1" />
          {showTasks && (
            <TaskTrigger
              activeTaskCount={activeTaskCount}
              attentionTaskBadge={attentionTaskBadge}
              hasTaskError={hasTaskError}
              onOpenTasks={onOpenTasks}
              tasksButtonLabel={tasksButtonLabel}
              tasksLiveStatus={tasksLiveStatus}
            />
          )}
          <Button className="gap-1 pl-3" onClick={onOpenMetadata}>
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
            onClick={onAddDocument}
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['newKnowledge.addDocument'])}
          </Button>
        </div>
        <div
          ref={resultsContainerRef}
          aria-labelledby="new-knowledge-documents-title"
          aria-busy={completingResults || isFetchingNextPage || sourcesPending || tasksPending}
          className="mt-3 overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          role="region"
          tabIndex={-1}
        >
          <table className="w-full table-fixed border-collapse text-left lg:table-auto">
            <thead className="system-xs-regular text-text-tertiary">
              <tr>
                <th className="py-2 font-normal">
                  <Checkbox
                    className="flex"
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    disabled={!canEdit || selectionDisabled || !hasSelectableDocuments}
                    aria-describedby={
                      !canEdit
                        ? readOnlyReasonId
                        : selectionDisabled && resultsIncomplete
                          ? PARTIAL_RESULTS_DESCRIPTION_ID
                          : undefined
                    }
                    aria-label={t(($) => $['newKnowledge.selectAllDocuments'])}
                    onCheckedChange={onSelectAll}
                  />
                </th>
                <th className="py-2 pr-6 font-normal">
                  {t(($) => $['newKnowledge.documentColumn'])}
                </th>
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
            <tbody>
              {visibleDocuments.map((document) => (
                <DocumentRow
                  key={document.id}
                  canDownload={canDownload}
                  document={document}
                  documentHref={getDocumentHref(document.id)}
                  failureReason={failureReasons.get(document.id)}
                  formatTimeFromNow={formatTimeFromNow}
                  onDownload={onDownloadDocument}
                  onRemove={onRemoveDocument}
                  onRename={onRenameDocument}
                  onSelectedChange={onSelectDocument}
                  onReindex={onReindexDocument}
                  onRetry={onRetryDocument}
                  onToggleAvailability={onToggleDocumentAvailability}
                  pendingAction={
                    pendingDocumentAction?.documentId === document.id
                      ? pendingDocumentAction.action
                      : undefined
                  }
                  readOnlyReasonId={
                    !canEdit
                      ? readOnlyReasonId
                      : selectionDisabled && resultsIncomplete
                        ? PARTIAL_RESULTS_DESCRIPTION_ID
                        : undefined
                  }
                  retryable={retryableDocumentIds.has(document.id)}
                  selected={selectedDocumentIds.has(document.id)}
                  selectionDisabled={!canEdit || selectionDisabled}
                  source={
                    (document.sourceId && sourceNames.get(document.sourceId)) ??
                    sourceName(document)
                  }
                  sourcePending={Boolean(
                    sourcesPending && document.sourceId && !sourceNames.has(document.sourceId),
                  )}
                  status={statuses.get(document.id) ?? 'queued'}
                  statusPending={Boolean(
                    tasksPending ||
                    (statusPending && document.sourceId && !sourceNames.has(document.sourceId)),
                  )}
                  tasksPending={tasksPending}
                />
              ))}
            </tbody>
          </table>
          {!documents.length &&
            !completingResults &&
            !isFetchNextPageError &&
            !resultsIncomplete && (
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
      </div>
      <p className="flex min-h-4 items-center gap-1.5 system-xs-regular text-text-tertiary">
        <span aria-hidden className="i-ri-information-2-line size-3.5" />
        {t(($) => $['newKnowledge.lastReadyRevisionHint'])}
      </p>
      {hasHiddenDocuments ? (
        <div className="mt-5 flex justify-center">
          <Button
            ref={loadMoreButtonRef}
            onBlur={() => {
              restoreLoadMoreFocusRef.current = false
            }}
            onClick={() => {
              restoreLoadMoreFocusRef.current = document.activeElement === loadMoreButtonRef.current
              setVisibleDocumentLimit((current) => current + DOCUMENT_RENDER_BATCH_SIZE)
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
              onLoadMore()
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
              onLoadMore()
            }}
          >
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function DocumentBulkActions({
  actionPending,
  availabilityDisabled,
  availabilityTargetEnabled,
  downloadDisabled,
  disabled,
  disabledReason,
  onBlurCapture,
  onClear,
  onDownload,
  onFocusCapture,
  onRemove,
  onReindex,
  onUpdateAvailability,
  reindexDisabled,
  selectedCount,
  showAvailabilityAction,
}: {
  actionPending?: 'availability' | 'download' | 'reindex' | 'remove'
  availabilityDisabled: boolean
  availabilityTargetEnabled: boolean
  disabled: boolean
  disabledReason?: string
  downloadDisabled: boolean
  onBlurCapture: FocusEventHandler<HTMLDivElement>
  onClear: () => void
  onDownload: () => void
  onFocusCapture: FocusEventHandler<HTMLDivElement>
  onRemove: () => Promise<boolean>
  onReindex: () => void
  onUpdateAvailability: () => void
  reindexDisabled: boolean
  selectedCount: number
  showAvailabilityAction: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const busy = Boolean(actionPending)

  return (
    <>
      <div className="pointer-events-none fixed right-0 bottom-[calc(1.75rem+env(safe-area-inset-bottom,0px))] left-0 z-20 flex justify-center pr-[calc(1rem+env(safe-area-inset-right,0px))] pl-[calc(1rem+env(safe-area-inset-left,0px))] sm:left-(--new-rag-sidebar-width,0px)">
        <div
          aria-label={t(($) => $['newKnowledge.bulkDocumentActions'])}
          className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-x-auto rounded-[14px] border border-divider-subtle bg-components-panel-bg py-2.5 pr-2.5 pl-4 shadow-[0_12px_32px_-6px_rgba(15,23,41,0.16),0_2px_6px_rgba(15,23,41,0.06)]"
          role="group"
          onBlurCapture={onBlurCapture}
          onFocusCapture={onFocusCapture}
        >
          <span className="shrink-0 text-[13px] leading-4.5 font-medium text-text-primary">
            {t(($) => $['newKnowledge.documentsSelected'], { count: selectedCount })}
          </span>
          <span aria-hidden className="h-5 w-px shrink-0 bg-divider-regular" />
          <Button
            aria-describedby={disabled ? 'document-reindex-unavailable' : undefined}
            aria-busy={actionPending === 'reindex'}
            className="shrink-0"
            disabled={disabled || reindexDisabled || busy}
            loading={actionPending === 'reindex'}
            size="small"
            onClick={onReindex}
          >
            {t(($) => $['newKnowledge.reindexDocuments'])}
          </Button>
          {disabled && disabledReason && (
            <span
              id="document-reindex-unavailable"
              className="max-w-44 shrink-0 system-2xs-regular text-text-tertiary"
              role="status"
            >
              {t(($) => $['newKnowledge.reindexDocuments'])}
              {' · '}
              {disabledReason}
            </span>
          )}
          <Button
            aria-busy={actionPending === 'download'}
            aria-describedby={downloadDisabled ? 'document-download-unavailable' : undefined}
            className="shrink-0"
            disabled={downloadDisabled || busy}
            loading={actionPending === 'download'}
            size="small"
            onClick={onDownload}
          >
            {t(($) => $['newKnowledge.downloadDocuments'])}
          </Button>
          {showAvailabilityAction && (
            <Button
              className="shrink-0"
              disabled={disabled || availabilityDisabled || busy}
              size="small"
              loading={actionPending === 'availability'}
              onClick={onUpdateAvailability}
            >
              {t(($) => (availabilityTargetEnabled ? $.enable : $['newKnowledge.disableSource']))}
            </Button>
          )}
          <Button
            className="shrink-0"
            disabled={disabled || busy}
            loading={actionPending === 'remove'}
            size="small"
            tone="destructive"
            variant="secondary"
            onClick={() => setRemoveDialogOpen(true)}
          >
            {tCommon(($) => $['operation.remove'])}
          </Button>
          <Button
            variant="ghost"
            size="small"
            aria-label={t(($) => $['newKnowledge.clearDocumentSelection'])}
            className="size-6.5 shrink-0 px-0"
            disabled={busy}
            onClick={onClear}
          >
            <span aria-hidden className="i-ri-close-line size-3.5" />
          </Button>
        </div>
      </div>
      <span id="document-download-unavailable" className="sr-only">
        {t(($) => $['newKnowledge.documentActionsUnavailable'])}
      </span>

      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={actionPending === 'remove'}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={actionPending === 'remove'}
              loading={actionPending === 'remove'}
              tone="destructive"
              onClick={() =>
                void onRemove().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
                })
              }
            >
              {tCommon(($) => $['operation.remove'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function DocumentDropOverlay() {
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
        {t(($) => $['newKnowledge.documentUploadFormats'])}
      </p>
    </div>
  )
}
