'use client'

import type { LogicalDocument } from '@dify/contracts/knowledge-fs/types.gen'
import type { DocumentDisplayStatus } from './document-model'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { sourceName } from './document-model'

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
      <Button aria-label={tasksButtonLabel} data-has-error={hasTaskError} onClick={onOpenTasks}>
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
    formatTimeFromNow,
    onSelectedChange,
    readOnlyReasonId,
    selected,
    selectionDisabled,
    source,
    sourcePending,
    status,
    statusPending,
  }: {
    document: LogicalDocument
    formatTimeFromNow: (time: number) => string
    onSelectedChange: (documentId: string) => void
    readOnlyReasonId?: string
    selected: boolean
    selectionDisabled: boolean
    source?: string
    sourcePending: boolean
    status: DocumentDisplayStatus
    statusPending: boolean
  }) => {
    const { t } = useTranslation('dataset')
    const { t: tCommon } = useTranslation('common')
    const titleId = `new-document-${document.id}`
    const revision = document.activeRevision ?? document.active?.revision
    const updatedTime = Date.parse(document.updatedAt)

    return (
      <tr
        className={cn(
          'border-t border-divider-subtle',
          status === 'disabled' && !statusPending && 'opacity-60',
        )}
      >
        <td className="w-10 py-3 pr-3">
          <Checkbox
            checked={selected}
            disabled={selectionDisabled || status === 'disabled'}
            aria-describedby={selectionDisabled ? readOnlyReasonId : undefined}
            aria-labelledby={titleId}
            onCheckedChange={() => onSelectedChange(document.id)}
          />
        </td>
        <td className="min-w-72 py-3 pr-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="i-ri-file-text-line size-[18px] shrink-0 text-text-tertiary"
            />
            <span id={titleId} className="truncate system-xs-medium text-text-primary">
              {document.title}
            </span>
            {revision !== undefined && (
              <span className="shrink-0 rounded border border-divider-regular px-1 system-2xs-medium text-text-tertiary">
                v{revision}
              </span>
            )}
          </div>
        </td>
        <td className="w-52 py-3 pr-6 system-xs-regular text-text-secondary">
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
        <td className="w-56 py-3 pr-6">
          {statusPending ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="h-3 w-20 animate-pulse rounded bg-background-section motion-reduce:animate-none"
              />
              <span className="sr-only">{tCommon(($) => $.loading)}</span>
            </span>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 system-xs-regular',
                status === 'failed' ? 'text-text-destructive' : 'text-text-secondary',
              )}
            >
              <span aria-hidden className={cn('size-3.5', statusIconClass[status])} />
              {t(($) => $[`newKnowledge.documentStatus.${status}`])}
            </span>
          )}
        </td>
        <td className="w-40 py-3 pr-6 system-xs-regular text-text-tertiary">
          {Number.isNaN(updatedTime) ? document.updatedAt : formatTimeFromNow(updatedTime)}
        </td>
        <td className="w-10 py-3 text-right">
          <button
            type="button"
            disabled
            aria-label={t(($) => $['newKnowledge.documentActions'], { name: document.title })}
            title={t(($) => $['newKnowledge.documentActionsUnavailable'])}
            className="inline-flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden"
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </button>
        </td>
      </tr>
    )
  },
)

export function DocumentsEmpty({
  activeTaskCount,
  attentionTaskBadge,
  canEdit,
  hasTaskError,
  onAddDocument,
  onDropFiles,
  onOpenTasks,
  readOnlyReasonId,
  tasksButtonLabel,
  tasksLiveStatus,
  uploading,
}: {
  activeTaskCount: number
  attentionTaskBadge?: string
  canEdit: boolean
  hasTaskError: boolean
  onAddDocument: () => void
  onDropFiles: (files: File[]) => void
  onOpenTasks: () => void
  readOnlyReasonId?: string
  tasksButtonLabel: string
  tasksLiveStatus: string
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  return (
    <div
      className="flex min-h-96 flex-1 flex-col items-center justify-center px-6 text-center"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (canEdit) onDropFiles([...event.dataTransfer.files])
      }}
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-background-section text-text-accent">
        <span aria-hidden className="i-ri-file-text-fill size-6" />
      </span>
      <h2 className="mt-4 system-md-semibold text-text-primary">
        {t(($) => $['newKnowledge.documentsEmptyTitle'])}
      </h2>
      <p className="mt-2 max-w-lg system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.documentsEmptyDescription'])}
      </p>
      <Button
        className="mt-4"
        variant="primary"
        disabled={!canEdit}
        loading={uploading}
        aria-describedby={!canEdit ? readOnlyReasonId : undefined}
        onClick={onAddDocument}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['newKnowledge.addDocument'])}
      </Button>
      <p className="mt-2 system-2xs-regular text-text-quaternary">
        {t(($) => $['newKnowledge.documentsDropHint'])}
      </p>
      <div className="mt-4">
        <TaskTrigger
          activeTaskCount={activeTaskCount}
          attentionTaskBadge={attentionTaskBadge}
          hasTaskError={hasTaskError}
          onOpenTasks={onOpenTasks}
          tasksButtonLabel={tasksButtonLabel}
          tasksLiveStatus={tasksLiveStatus}
        />
      </div>
    </div>
  )
}

export function DocumentsList({
  activeTaskCount,
  allSelected,
  attentionTaskBadge,
  canEdit,
  completingResults,
  documents,
  filter,
  hasNextPage,
  hasSelectableDocuments,
  hasTaskError,
  isFetchNextPageError,
  isFetchingNextPage,
  onAddDocument,
  onFilterChange,
  onLoadMore,
  onOpenTasks,
  onSearchChange,
  onSelectAll,
  onSelectDocument,
  readOnlyReasonId,
  resultsIncomplete,
  search,
  selectionDisabled,
  selectedDocumentIds,
  someSelected,
  sourcesPending,
  sourceNames,
  statusPending,
  statuses,
  tasksPending,
  tasksButtonLabel,
  tasksLiveStatus,
  uploading,
}: {
  activeTaskCount: number
  allSelected: boolean
  attentionTaskBadge?: string
  canEdit: boolean
  completingResults: boolean
  documents: LogicalDocument[]
  filter: DocumentFilter
  hasNextPage: boolean
  hasSelectableDocuments: boolean
  hasTaskError: boolean
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  onAddDocument: () => void
  onFilterChange: (filter: DocumentFilter) => void
  onLoadMore: () => void
  onOpenTasks: () => void
  onSearchChange: (search: string) => void
  onSelectAll: () => void
  onSelectDocument: (documentId: string) => void
  readOnlyReasonId?: string
  resultsIncomplete: boolean
  search: string
  selectionDisabled: boolean
  selectedDocumentIds: Set<string>
  someSelected: boolean
  sourcesPending: boolean
  sourceNames: Map<string, string>
  statusPending: boolean
  statuses: Map<string, DocumentDisplayStatus>
  tasksPending: boolean
  tasksButtonLabel: string
  tasksLiveStatus: string
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [visibleDocumentLimit, setVisibleDocumentLimit] = useState(DOCUMENT_RENDER_BATCH_SIZE)
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const visibleDocuments = documents.slice(0, visibleDocumentLimit)
  const hasHiddenDocuments = visibleDocuments.length < documents.length

  return (
    <>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="document-filter">
          {t(($) => $['newKnowledge.documentFilterLabel'])}
        </label>
        <select
          id="document-filter"
          disabled={statusPending}
          value={filter}
          onChange={(event) => {
            setVisibleDocumentLimit(DOCUMENT_RENDER_BATCH_SIZE)
            onFilterChange(event.target.value as DocumentFilter)
          }}
          className="h-8 rounded-lg border-0 bg-components-input-bg-normal px-3 system-xs-regular text-text-secondary outline-hidden focus:ring-2 focus:ring-state-accent-solid sm:w-36"
        >
          <option value="all">{t(($) => $['newKnowledge.allDocumentStatuses'])}</option>
          {(['ready', 'queued', 'processing', 'failed', 'disabled'] as const).map((status) => (
            <option key={status} value={status}>
              {t(($) => $[`newKnowledge.documentStatus.${status}`])}
            </option>
          ))}
        </select>
        <label className="relative sm:w-60">
          <span className="sr-only">{t(($) => $['newKnowledge.searchDocuments'])}</span>
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-2.5 i-ri-search-line size-4 text-text-quaternary"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setVisibleDocumentLimit(DOCUMENT_RENDER_BATCH_SIZE)
              onSearchChange(event.target.value)
            }}
            placeholder={t(($) => $['newKnowledge.searchDocuments'])}
            className="h-8 w-full rounded-lg border-0 bg-components-input-bg-normal pr-3 pl-8 system-xs-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
          />
        </label>
        <span className="min-w-0 flex-1" />
        <TaskTrigger
          activeTaskCount={activeTaskCount}
          attentionTaskBadge={attentionTaskBadge}
          hasTaskError={hasTaskError}
          onOpenTasks={onOpenTasks}
          tasksButtonLabel={tasksButtonLabel}
          tasksLiveStatus={tasksLiveStatus}
        />
        <Button disabled title={t(($) => $['newKnowledge.documentActionsUnavailable'])}>
          <span aria-hidden className="i-ri-price-tag-3-line size-4" />
          {t(($) => $['newKnowledge.metadata'])}
        </Button>
        <Button
          variant="primary"
          disabled={!canEdit}
          loading={uploading}
          aria-describedby={!canEdit ? readOnlyReasonId : undefined}
          onClick={onAddDocument}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addDocument'])}
        </Button>
      </div>
      <div aria-busy={completingResults || isFetchingNextPage} className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="system-2xs-medium text-text-tertiary uppercase">
            <tr>
              <th className="pb-2 font-medium">
                <Checkbox
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
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.documentColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.sourceColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.statusColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.updatedColumn'])}</th>
              <th aria-label={t(($) => $['newKnowledge.actionsColumn'])} />
            </tr>
          </thead>
          <tbody>
            {visibleDocuments.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                formatTimeFromNow={formatTimeFromNow}
                onSelectedChange={onSelectDocument}
                readOnlyReasonId={
                  !canEdit
                    ? readOnlyReasonId
                    : selectionDisabled && resultsIncomplete
                      ? PARTIAL_RESULTS_DESCRIPTION_ID
                      : undefined
                }
                selected={selectedDocumentIds.has(document.id)}
                selectionDisabled={!canEdit || selectionDisabled}
                source={
                  (document.sourceId && sourceNames.get(document.sourceId)) ?? sourceName(document)
                }
                sourcePending={Boolean(
                  sourcesPending && document.sourceId && !sourceNames.has(document.sourceId),
                )}
                status={statuses.get(document.id) ?? 'queued'}
                statusPending={Boolean(
                  tasksPending ||
                  (statusPending && document.sourceId && !sourceNames.has(document.sourceId)),
                )}
              />
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
      <p className="mt-3 flex items-center gap-1.5 system-xs-regular text-text-tertiary">
        <span aria-hidden className="i-ri-information-2-line size-3.5" />
        {t(($) => $['newKnowledge.lastReadyRevisionHint'])}
      </p>
      {hasHiddenDocuments ? (
        <div className="mt-5 flex justify-center">
          <Button
            onClick={() =>
              setVisibleDocumentLimit((current) => current + DOCUMENT_RENDER_BATCH_SIZE)
            }
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
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
            loading={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : hasNextPage && (!filterActive || !completingResults) ? (
        <div className="mt-5 flex justify-center">
          <Button loading={isFetchingNextPage} onClick={onLoadMore}>
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function DocumentBulkActions({
  disabled,
  onClear,
  onReindex,
  reindexing,
  selectedCount,
}: {
  disabled: boolean
  onClear: () => void
  onReindex: () => void
  reindexing: boolean
  selectedCount: number
}) {
  const { t } = useTranslation('dataset')
  return (
    <div
      aria-label={t(($) => $['newKnowledge.bulkDocumentActions'])}
      className="fixed bottom-7 left-1/2 z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-[14px] border border-divider-subtle bg-components-panel-bg px-3 py-2.5 shadow-xl"
      role="toolbar"
    >
      <span className="shrink-0 px-1 system-xs-medium text-text-primary">
        {t(($) => $['newKnowledge.documentsSelected'], { count: selectedCount })}
      </span>
      <span id="document-actions-unavailable" className="sr-only">
        {t(($) => $['newKnowledge.documentActionsUnavailable'])}
      </span>
      <Button
        className="shrink-0"
        size="small"
        disabled={disabled}
        loading={reindexing}
        onClick={onReindex}
      >
        {t(($) => $['newKnowledge.reindexDocuments'])}
      </Button>
      <Button
        className="shrink-0"
        size="small"
        disabled
        aria-describedby="document-actions-unavailable"
      >
        {t(($) => $['newKnowledge.downloadDocuments'])}
      </Button>
      <Button
        className="shrink-0"
        size="small"
        disabled
        aria-describedby="document-actions-unavailable"
      >
        {t(($) => $['newKnowledge.deleteDocuments'])}
      </Button>
      <button
        type="button"
        aria-label={t(($) => $['newKnowledge.clearDocumentSelection'])}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onClear}
      >
        <span aria-hidden className="i-ri-close-line size-4" />
      </button>
    </div>
  )
}
