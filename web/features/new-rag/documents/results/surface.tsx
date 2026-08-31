'use client'

import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentPermissionRecoverySurface } from '../permission-recovery/recovery-boundary'
import type { useTaskRuntime } from '../tasks/use-task-runtime'
import type { DocumentUploadPermission } from '../upload/surface'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { knowledgeFsTaskFailureMessageKey } from '../../knowledge-fs-task-error'
import { newKnowledgeDocumentDetailPath } from '../../routes'
import { sourceFromApi } from '../../sources/source-models'
import { useDocumentBulkSelection } from '../bulk/selection-state'
import { DocumentBulkActionsToolbar } from '../bulk/toolbar'
import { DocumentsEmpty, DocumentsList } from '../list'
import {
  documentDisplayStatus,
  newestTaskByDocument,
  sourceName,
  taskNeedsAttention,
} from '../model'
import { logicalDocumentListFromApi } from '../models'
import {
  DocumentPermissionRecoveryBoundary,
  DocumentPermissionRecoveryBulkRegion,
  DocumentReadPermissionRecovery,
} from '../permission-recovery/recovery-boundary'
import { documentSourcesInfiniteOptions, logicalDocumentsInfiniteOptions } from '../queries'
import { documentFilterParser, documentSearchParser } from '../query-state'
import { responseStatus } from '../request-error'
import { MAX_AUTO_CURSOR_PAGES, queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'
import {
  DocumentUploadContent,
  DocumentUploadHeader,
  DocumentUploadSurface,
} from '../upload/surface'

type DocumentTaskRuntime = ReturnType<typeof useTaskRuntime>

export function DocumentResultsSurface({
  canDownload,
  ensureModelReady,
  knowledgeSpaceId,
  metadataOpen,
  onOpenMetadata,
  onOpenTasks,
  onReadDenied,
  permission,
  recoverySurface,
  taskRuntime,
  tasksOpen,
}: {
  canDownload: boolean
  ensureModelReady: EnsureKnowledgeModelReady
  knowledgeSpaceId: string
  metadataOpen: boolean
  onOpenMetadata: () => void
  onOpenTasks: () => void
  onReadDenied: () => void
  permission: DocumentUploadPermission
  recoverySurface: DocumentPermissionRecoverySurface
  taskRuntime: DocumentTaskRuntime
  tasksOpen: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { canRead, canWrite, denyWrite: onWriteDenied } = permission
  const [filter, setFilter] = useQueryState('status', documentFilterParser)
  const [search, setSearch] = useQueryState('query', documentSearchParser)
  const [blockingDependencyRetries, setBlockingDependencyRetries] = useState({
    sources: false,
    tasks: false,
  })
  const mainRetryFocusRequestedRef = useRef(false)
  const documentsRetryButtonRef = useRef<HTMLButtonElement>(null)
  const dependencyRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentsQuery = useInfiniteQuery(logicalDocumentsInfiniteOptions(knowledgeSpaceId))
  const documentPermissionDenied = responseStatus(documentsQuery.error) === 403
  const sourcesQuery = useInfiniteQuery(
    documentSourcesInfiniteOptions(knowledgeSpaceId, { enabled: !documentPermissionDenied }),
  )
  const {
    acceptTaskSnapshot: onTaskUpdated,
    activeTasks,
    baseTasks,
    drawerTasks,
    tasks,
    tasksQuery,
  } = taskRuntime
  const {
    fetchNextPage: fetchNextDocumentPage,
    hasNextPage: hasNextDocumentPage,
    isFetchNextPageError: isFetchNextDocumentPageError,
    isFetchingNextPage: isFetchingNextDocumentPage,
  } = documentsQuery
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchNextPageError: isFetchNextSourcePageError,
    isFetchingNextPage: isFetchingNextSourcePage,
  } = sourcesQuery
  const canAutoFetchDocumentPage = Boolean(
    hasNextDocumentPage && (documentsQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const documents = useMemo(
    () =>
      documentsQuery.data?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ?? [],
    [documentsQuery.data],
  )
  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents])
  const unresolvedTaskDocumentIds = useMemo(
    () =>
      new Set(
        baseTasks.flatMap((task) => (!documentIds.has(task.documentId) ? [task.documentId] : [])),
      ),
    [baseTasks, documentIds],
  )
  const sources = useMemo(
    () =>
      sourcesQuery.data?.pages.flatMap((page) =>
        page.data.map((source) => sourceFromApi(source)),
      ) ?? [],
    [sourcesQuery.data],
  )
  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  )
  const unresolvedDocumentSourceIds = useMemo(
    () =>
      new Set(
        documents.flatMap((document) =>
          document.sourceId && !sourceNames.has(document.sourceId) ? [document.sourceId] : [],
        ),
      ),
    [documents, sourceNames],
  )
  const hasRelevantNextSourcePage = Boolean(hasNextSourcePage && unresolvedDocumentSourceIds.size)
  const isFetchingNextResultsPage = Boolean(
    isFetchingNextDocumentPage || (hasRelevantNextSourcePage && isFetchingNextSourcePage),
  )
  const canAutoFetchSourcePage = Boolean(
    hasRelevantNextSourcePage && (sourcesQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const taskByDocument = useMemo(() => newestTaskByDocument(tasks), [tasks])
  const documentStatuses = useMemo(
    () =>
      new Map(
        documents.map((document) => [
          document.id,
          documentDisplayStatus(document, taskByDocument.get(document.id)),
        ]),
      ),
    [documents, taskByDocument],
  )
  const documentFailureReasons = useMemo(
    () =>
      new Map(
        documents.flatMap((document) => {
          if (documentStatuses.get(document.id) !== 'failed') return []
          const task = taskByDocument.get(document.id)
          const messageKey =
            knowledgeFsTaskFailureMessageKey(
              task?.failure,
              task?.errorCode ?? (task?.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
            ) ?? 'newKnowledge.taskFailure.internal'
          return [[document.id, t(($) => $[messageKey])] as const]
        }),
      ),
    [documentStatuses, documents, t, taskByDocument],
  )
  const taskResultsIncomplete = Boolean(!tasksQuery.data || tasksQuery.isPending)
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return documents.filter((document) => {
      const status = documentStatuses.get(document.id)
      if (filter !== 'all' && status !== filter) return false
      if (!normalizedSearch) return true
      const resolvedSourceName =
        (document.sourceId && sourceNames.get(document.sourceId)) ?? sourceName(document)
      return `${document.title} ${resolvedSourceName ?? ''}`
        .toLocaleLowerCase()
        .includes(normalizedSearch)
    })
  }, [documentStatuses, documents, filter, search, sourceNames])
  const completingFilteredResults =
    filterActive &&
    !documentsQuery.isFetchNextPageError &&
    (canAutoFetchDocumentPage || documentsQuery.isFetchingNextPage)
  const filteredResultsIncomplete = Boolean(
    (filterActive &&
      (hasNextDocumentPage ||
        documentsQuery.isFetchingNextPage ||
        documentsQuery.isFetchNextPageError)) ||
    (filterActive &&
      unresolvedDocumentSourceIds.size > 0 &&
      (hasNextSourcePage || sourcesQuery.isFetchingNextPage || sourcesQuery.isFetchNextPageError)),
  )
  const taskQueryBlockingError = Boolean(
    !tasksQuery.data && (tasksQuery.error || blockingDependencyRetries.tasks),
  )
  const sourceQueryBlockingError = Boolean(
    !sourcesQuery.data && (sourcesQuery.error || blockingDependencyRetries.sources),
  )
  const dependencyQueryBlockingError = taskQueryBlockingError || sourceQueryBlockingError
  const dependencyQueryWarning = Boolean(
    (tasksQuery.error && tasksQuery.data) ||
    (sourcesQuery.error && sourcesQuery.data) ||
    sourcesQuery.isFetchNextPageError,
  )
  const sourceResultsIncomplete = Boolean(
    !sourcesQuery.data ||
    sourcesQuery.isPending ||
    (unresolvedDocumentSourceIds.size &&
      (hasNextSourcePage ||
        sourcesQuery.error ||
        sourcesQuery.isFetchingNextPage ||
        sourcesQuery.isFetchNextPageError)),
  )
  const sourceQueryWarning = Boolean(
    (sourcesQuery.error && sourcesQuery.data) || sourcesQuery.isFetchNextPageError,
  )
  const taskQueryWarning = Boolean(tasksQuery.error && tasksQuery.data)
  const documentQueryWarning = Boolean(documentsQuery.error && documentsQuery.data)
  const dependencyRetryFetching = Boolean(
    (taskQueryWarning && tasksQuery.isFetching) || (sourceQueryWarning && sourcesQuery.isFetching),
  )
  const blockingDependencyRetryFetching = Boolean(
    (taskQueryBlockingError && tasksQuery.isFetching) ||
    (sourceQueryBlockingError && sourcesQuery.isFetching),
  )
  const mainRecoveryVisible = Boolean(
    documentsQuery.error || dependencyQueryBlockingError || dependencyQueryWarning,
  )
  const mainRecoveryIdentity = [
    documentsQuery.error ? 'documents' : '',
    taskQueryBlockingError ? 'tasks-blocking' : '',
    sourceQueryBlockingError ? 'sources-blocking' : '',
    taskQueryWarning ? 'tasks-warning' : '',
    sourceQueryWarning ? 'sources-warning' : '',
  ].join(':')
  const dependencyResultsIncomplete = taskResultsIncomplete || sourceResultsIncomplete
  const selectionDisabled =
    !canWrite ||
    dependencyResultsIncomplete ||
    documentQueryWarning ||
    taskQueryWarning ||
    (sourceQueryWarning && unresolvedDocumentSourceIds.size > 0) ||
    filteredResultsIncomplete
  const reindexUnavailableReason =
    tasksQuery.error || tasksQuery.isFetchNextPageError
      ? t(($) => $['newKnowledge.tasksErrorDescription'])
      : (sourcesQuery.error || sourcesQuery.isFetchNextPageError) &&
          unresolvedDocumentSourceIds.size > 0
        ? t(($) => $['newKnowledge.sourcesErrorDescription'])
        : documentsQuery.error || documentsQuery.isFetchNextPageError
          ? t(($) => $['newKnowledge.documentsErrorDescription'])
          : dependencyResultsIncomplete
            ? tCommon(($) => $.loading)
            : filteredResultsIncomplete
              ? t(($) => $['newKnowledge.partialDocumentResults'])
              : undefined
  const bulkSelection = useDocumentBulkSelection({
    canSelect: canWrite && !selectionDisabled,
    documents,
    filteredDocuments,
    statuses: documentStatuses,
    taskResultsIncomplete,
  })
  const attentionTasks = drawerTasks.filter(taskNeedsAttention)
  const hasTaskError = attentionTasks.some(
    (task) => task.state === 'failed' || task.state === 'canceled',
  )
  const incompleteTaskHistoryHint = tasksQuery.hasNextPage
    ? ` · ${t(($) => $['newKnowledge.taskHistoryIncomplete'])}`
    : ''
  const attentionTaskBadge =
    attentionTasks.length || tasksQuery.hasNextPage
      ? `${attentionTasks.length}${tasksQuery.hasNextPage ? '+' : ''}`
      : undefined
  const tasksButtonLabel = `${
    attentionTasks.length || tasksQuery.hasNextPage
      ? t(($) => $['newKnowledge.tasksWithAttention'], { count: attentionTasks.length })
      : t(($) => $['newKnowledge.tasks'])
  }${incompleteTaskHistoryHint}`
  const tasksLiveStatus = `${
    hasTaskError
      ? t(($) => $['newKnowledge.taskAttentionErrorCount'], { count: attentionTasks.length })
      : attentionTasks.length || tasksQuery.hasNextPage
        ? t(($) => $['newKnowledge.taskAttentionCount'], { count: attentionTasks.length })
        : t(($) => $['newKnowledge.taskAttentionClear'])
  }${incompleteTaskHistoryHint}`
  const bulkActionsVisible = canWrite && bulkSelection.selectedDocumentIds.size > 0

  useEffect(() => {
    if (!mainRetryFocusRequestedRef.current) return
    if (mainRecoveryVisible) {
      if (documentsQuery.error && canRead) documentsRetryButtonRef.current?.focus()
      else dependencyRetryButtonRef.current?.focus()
      return
    }
    mainRetryFocusRequestedRef.current = false
    document.getElementById('new-knowledge-documents-title')?.focus()
  }, [canRead, documentsQuery.error, mainRecoveryIdentity, mainRecoveryVisible])

  useEffect(() => {
    if (!blockingDependencyRetries.tasks && !blockingDependencyRetries.sources) return
    if (
      (!blockingDependencyRetries.tasks || !tasksQuery.data) &&
      (!blockingDependencyRetries.sources || !sourcesQuery.data)
    )
      return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Successful first-page retries retire the locally stabilized blocking state.
    setBlockingDependencyRetries((current) => ({
      sources: current.sources && !sourcesQuery.data,
      tasks: current.tasks && !tasksQuery.data,
    }))
  }, [blockingDependencyRetries, sourcesQuery.data, tasksQuery.data])

  useEffect(() => {
    if (
      canRead &&
      (filterActive || (tasksOpen && unresolvedTaskDocumentIds.size > 0)) &&
      canAutoFetchDocumentPage &&
      !isFetchingNextDocumentPage &&
      !isFetchNextDocumentPageError
    )
      void fetchNextDocumentPage()
  }, [
    canAutoFetchDocumentPage,
    canRead,
    fetchNextDocumentPage,
    filterActive,
    isFetchNextDocumentPageError,
    isFetchingNextDocumentPage,
    tasksOpen,
    unresolvedTaskDocumentIds,
  ])

  useEffect(() => {
    if (
      canRead &&
      canAutoFetchSourcePage &&
      !isFetchingNextSourcePage &&
      !isFetchNextSourcePageError
    )
      void fetchNextSourcePage()
  }, [
    canAutoFetchSourcePage,
    canRead,
    fetchNextSourcePage,
    isFetchNextSourcePageError,
    isFetchingNextSourcePage,
  ])

  const refreshDocumentsAndTasks = () => {
    void Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
      }),
    ])
  }

  const retryDependencyQueries = () => {
    if (taskQueryBlockingError || sourceQueryBlockingError)
      setBlockingDependencyRetries((current) => ({
        sources: current.sources || sourceQueryBlockingError,
        tasks: current.tasks || taskQueryBlockingError,
      }))
    if (tasksQuery.error || taskQueryBlockingError) void tasksQuery.refetch()
    if (sourcesQuery.isFetchNextPageError) void sourcesQuery.fetchNextPage()
    else if (sourcesQuery.error || sourceQueryBlockingError) void sourcesQuery.refetch()
  }

  const loadMoreResults = () => {
    const requests: Promise<unknown>[] = []
    if (hasNextDocumentPage && !isFetchingNextDocumentPage) requests.push(fetchNextDocumentPage())
    if (hasRelevantNextSourcePage && !isFetchingNextSourcePage) requests.push(fetchNextSourcePage())
    void Promise.allSettled(requests)
  }

  return (
    <DocumentPermissionRecoveryBoundary
      bulkActionsVisible={bulkActionsVisible}
      onReadDenied={onReadDenied}
      readSurfaceOpen={tasksOpen || metadataOpen}
      recoverySurface={recoverySurface}
    >
      <DocumentUploadSurface
        bulkActionsVisible={bulkActionsVisible}
        knowledgeSpaceId={knowledgeSpaceId}
        onUploadStarted={refreshDocumentsAndTasks}
        permission={permission}
      >
        <DocumentUploadHeader />
        <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId={knowledgeSpaceId} />
        {documentsQuery.error &&
          documentsQuery.data &&
          canRead &&
          !documentsQuery.isFetchNextPageError && (
            <div
              className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
              role="alert"
            >
              <span className="system-xs-regular text-text-tertiary">
                {t(($) =>
                  responseStatus(documentsQuery.error) === 403
                    ? $['newKnowledge.documentsPermissionDescription']
                    : $['newKnowledge.documentsErrorDescription'],
                )}
              </span>
              {responseStatus(documentsQuery.error) !== 403 && (
                <Button
                  ref={documentsRetryButtonRef}
                  aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
                  aria-busy={documentsQuery.isRefetching}
                  loading={documentsQuery.isRefetching}
                  size="small"
                  onBlur={(event) => {
                    if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
                  }}
                  onClick={() => {
                    mainRetryFocusRequestedRef.current = true
                    void documentsQuery.refetch()
                  }}
                >
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              )}
            </div>
          )}
        {canRead && !dependencyQueryBlockingError && dependencyQueryWarning && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
            role="alert"
          >
            <span className="system-xs-regular text-text-tertiary">
              {sourcesQuery.error || sourcesQuery.isFetchNextPageError
                ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                : t(($) => $['newKnowledge.tasksErrorDescription'])}
            </span>
            <Button
              ref={dependencyRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${
                sourcesQuery.error || sourcesQuery.isFetchNextPageError
                  ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                  : t(($) => $['newKnowledge.tasksErrorDescription'])
              }`}
              aria-busy={dependencyRetryFetching}
              loading={dependencyRetryFetching}
              size="small"
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                retryDependencyQueries()
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}
        {documentsQuery.isPending && canRead ? (
          <div className="flex min-h-64 flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : !canRead ? (
          <DocumentReadPermissionRecovery
            fetching={documentsQuery.isFetching}
            recoverySurface={recoverySurface}
          />
        ) : documentsQuery.error && !documentsQuery.data ? (
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
              ref={documentsRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
              aria-busy={documentsQuery.isFetching}
              className="mt-4"
              loading={documentsQuery.isFetching}
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                void documentsQuery.refetch()
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        ) : dependencyQueryBlockingError ? (
          <div
            className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
            <p className="mt-3 max-w-md body-sm-regular text-text-tertiary">
              {taskQueryBlockingError
                ? t(($) => $['newKnowledge.tasksErrorDescription'])
                : t(($) => $['newKnowledge.sourcesErrorDescription'])}
            </p>
            <Button
              ref={dependencyRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${
                taskQueryBlockingError
                  ? t(($) => $['newKnowledge.tasksErrorDescription'])
                  : t(($) => $['newKnowledge.sourcesErrorDescription'])
              }`}
              aria-busy={blockingDependencyRetryFetching}
              className="mt-4"
              loading={blockingDependencyRetryFetching}
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                retryDependencyQueries()
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        ) : (
          <DocumentUploadContent>
            {(upload) =>
              !documents.length ? (
                <DocumentsEmpty
                  canEdit={upload.canUpload}
                  onAddDocument={() => upload.openUpload()}
                  onOpenMetadata={onOpenMetadata}
                  readOnlyReasonId={upload.uploadRestrictionReasonId}
                  uploading={upload.uploading}
                />
              ) : (
                <DocumentsList
                  activeTaskCount={activeTasks.length}
                  allSelected={bulkSelection.allFilteredSelected}
                  attentionTaskBadge={attentionTaskBadge}
                  canDownload={canDownload}
                  canEdit={canWrite}
                  canUpload={upload.canUpload}
                  completingResults={completingFilteredResults}
                  documents={filteredDocuments}
                  ensureModelReady={ensureModelReady}
                  failureReasons={documentFailureReasons}
                  filter={filter}
                  getDocumentHref={(documentId) =>
                    newKnowledgeDocumentDetailPath(knowledgeSpaceId, documentId)
                  }
                  hasNextPage={Boolean(hasNextDocumentPage || hasRelevantNextSourcePage)}
                  hasSelectableDocuments={bulkSelection.hasSelectableDocuments}
                  hasTaskError={hasTaskError}
                  isFetchNextPageError={documentsQuery.isFetchNextPageError}
                  isFetchingNextDocumentPage={isFetchingNextDocumentPage}
                  isFetchingNextPage={isFetchingNextResultsPage}
                  knowledgeSpaceId={knowledgeSpaceId}
                  onAddDocument={() => upload.openUpload()}
                  onDocumentRemoved={bulkSelection.remove}
                  onFilterChange={setFilter}
                  onLoadMore={loadMoreResults}
                  onOpenMetadata={onOpenMetadata}
                  onOpenTasks={onOpenTasks}
                  onSearchChange={setSearch}
                  onSelectAll={bulkSelection.toggleAllFiltered}
                  onSelectDocument={bulkSelection.toggle}
                  onTaskUpdated={onTaskUpdated}
                  onWriteDenied={onWriteDenied}
                  readOnlyReasonId={upload.readOnlyReasonId}
                  resultsIncomplete={filteredResultsIncomplete}
                  search={search}
                  selectionDisabled={selectionDisabled}
                  selectedDocumentIds={bulkSelection.selectedDocumentIds}
                  showTasks={Boolean(
                    tasks.length ||
                    tasksQuery.error ||
                    tasksQuery.isFetchNextPageError ||
                    tasksQuery.hasNextPage,
                  )}
                  someSelected={bulkSelection.someFilteredSelected}
                  sourcesPending={sourceResultsIncomplete}
                  sourceNames={sourceNames}
                  statusPending={dependencyResultsIncomplete}
                  statuses={documentStatuses}
                  tasksByDocument={taskByDocument}
                  tasksPending={taskResultsIncomplete}
                  tasksButtonLabel={tasksButtonLabel}
                  tasksLiveStatus={tasksLiveStatus}
                  uploadRestrictionReasonId={upload.uploadRestrictionReasonId}
                  uploading={upload.uploading}
                />
              )
            }
          </DocumentUploadContent>
        )}
      </DocumentUploadSurface>
      <DocumentPermissionRecoveryBulkRegion>
        {bulkActionsVisible && (
          <DocumentBulkActionsToolbar
            canDownload={canDownload}
            canWrite={canWrite}
            disabled={selectionDisabled}
            disabledReason={reindexUnavailableReason}
            ensureModelReady={ensureModelReady}
            knowledgeSpaceId={knowledgeSpaceId}
            onWriteDenied={onWriteDenied}
            selection={bulkSelection}
          />
        )}
      </DocumentPermissionRecoveryBulkRegion>
    </DocumentPermissionRecoveryBoundary>
  )
}
