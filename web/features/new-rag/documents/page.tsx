'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { knowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { sourceFromApi } from '../sources/source-models'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { useDocumentBulkSelection } from './bulk/selection-state'
import { DocumentBulkActionsToolbar } from './bulk/toolbar'
import { DocumentsEmpty, DocumentsList } from './list'
import { DocumentMetadataDrawer } from './metadata/drawer'
import {
  documentDisplayStatus,
  newestTaskByDocument,
  sourceName,
  taskNeedsAttention,
} from './model'
import { logicalDocumentListFromApi } from './models'
import {
  DocumentPermissionRecoveryBoundary,
  DocumentPermissionRecoveryBulkRegion,
  DocumentReadPermissionRecovery,
} from './permission-recovery/recovery-boundary'
import { useDocumentPermissionRecovery } from './permission-recovery/use-permission-recovery'
import { documentSourcesInfiniteOptions, logicalDocumentsInfiniteOptions } from './queries'
import { documentFilterParser, documentMetadataParser, documentSearchParser } from './query-state'
import { responseStatus } from './request-error'
import { useAuxiliaryTaskReadGuard } from './tasks/auxiliary-read-guard'
import { ProcessingTasksDrawer } from './tasks/drawer'
import { TaskEventObserver } from './tasks/event-observer'
import { MAX_AUTO_CURSOR_PAGES, queryKeyMatchesKnowledgeSpace } from './tasks/recovery'
import { useTaskRuntime } from './tasks/use-task-runtime'
import {
  DocumentUploadContent,
  DocumentUploadHeader,
  DocumentUploadSurface,
} from './upload/surface'

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const hasDocumentDownloadPermission = hasPermission(
    datasetDefaultPermissionKeys,
    DatasetACLPermission.DocumentDownload,
  )
  const canDownload =
    hasDocumentDownloadPermission &&
    !workspacePermissionKeysLoading &&
    !workspacePermissionKeysError
  const [filter, setFilter] = useQueryState('status', documentFilterParser)
  const [search, setSearch] = useQueryState('query', documentSearchParser)
  const [metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const metadataOpen = metadataRequest === '1'
  const setMetadataOpen = useCallback(
    (open: boolean) => {
      void setMetadataRequest(open ? '1' : null)
    },
    [setMetadataRequest],
  )
  const [tasksOpen, setTasksOpen] = useState(false)
  const [blockingDependencyRetries, setBlockingDependencyRetries] = useState({
    sources: false,
    tasks: false,
  })
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)

  const documentsQuery = useInfiniteQuery(logicalDocumentsInfiniteOptions(knowledgeSpaceId))
  const documentPermissionDenied = responseStatus(documentsQuery.error) === 403
  const refetchDocumentsQuery = documentsQuery.refetch
  const {
    deny: denyAuxiliaryTaskRead,
    guard: auxiliaryTaskReadGuard,
    permissionDenied: auxiliaryReadPermissionDenied,
    retry: retryAuxiliaryTaskRead,
  } = useAuxiliaryTaskReadGuard({
    documentPermissionDenied,
    refetchDocuments: refetchDocumentsQuery,
  })
  const sourcesQuery = useInfiniteQuery(
    documentSourcesInfiniteOptions(knowledgeSpaceId, { enabled: !documentPermissionDenied }),
  )
  const sourcePermissionDenied = responseStatus(sourcesQuery.error) === 403
  const refreshDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
    })
  }, [knowledgeSpaceId, queryClient])
  const notifyTaskFailed = useCallback(
    () => toast.error(t(($) => $['newKnowledge.taskFailedNotification'])),
    [t],
  )
  const {
    acceptTaskSnapshot: handleTaskUpdated,
    activeTasks,
    baseTasks,
    drawerTasks,
    handleTaskEvent,
    handleTaskEventCursor,
    handleTaskStreamPermissionDenied,
    observerGeneration,
    observerVersion,
    resetFailedPollBlocks,
    runtimeState: taskRuntimeState,
    streamedActiveTasks,
    taskPermissionDenied,
    taskProgressStore,
    tasks,
    tasksQuery,
  } = useTaskRuntime({
    auxiliaryTaskReadGuard,
    denyAuxiliaryTaskRead,
    documentPermissionDenied,
    externalPermissionDenied:
      documentPermissionDenied || auxiliaryReadPermissionDenied || sourcePermissionDenied,
    knowledgeSpaceId,
    onTaskFailed: notifyTaskFailed,
    onTaskReachedTerminal: refreshDocuments,
    tasksOpen,
  })
  const refetchTasksQuery = tasksQuery.refetch
  const refetchSourcesQuery = sourcesQuery.refetch
  const {
    canRead,
    canWrite,
    denyWrite: handleWritePermissionDenied,
    recoverySurface,
    retryWorkspacePermission,
    workspacePermissionRefreshing,
  } = useDocumentPermissionRecovery({
    auxiliaryReadPermissionDenied,
    documentPermissionDenied,
    knowledgeSpaceId,
    onRetryAuxiliaryRead: retryAuxiliaryTaskRead,
    refetchSources: refetchSourcesQuery,
    refetchTasks: refetchTasksQuery,
    resetFailedPollBlocks,
    sourcePermissionDenied,
    taskPermissionDenied,
  })
  const uploadPermission = useMemo(
    () => ({ canRead, canWrite, denyWrite: handleWritePermissionDenied }),
    [canRead, canWrite, handleWritePermissionDenied],
  )
  const mainRetryFocusRequestedRef = useRef(false)
  const documentsRetryButtonRef = useRef<HTMLButtonElement>(null)
  const dependencyRetryButtonRef = useRef<HTMLButtonElement>(null)
  const {
    fetchNextPage: fetchNextDocumentPage,
    hasNextPage: hasNextDocumentPage,
    isFetchNextPageError: isFetchNextDocumentPageError,
    isFetchingNextPage: isFetchingNextDocumentPage,
  } = documentsQuery
  const {
    fetchNextPage: fetchNextTaskPage,
    hasNextPage: hasNextTaskPage,
    isFetchingNextPage: isFetchingNextTaskPage,
  } = tasksQuery
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
  const incompleteTaskHistoryHint = hasNextTaskPage
    ? ` · ${t(($) => $['newKnowledge.taskHistoryIncomplete'])}`
    : ''
  const attentionTaskBadge =
    attentionTasks.length || hasNextTaskPage
      ? `${attentionTasks.length}${hasNextTaskPage ? '+' : ''}`
      : undefined
  const tasksButtonLabel = `${
    attentionTasks.length || hasNextTaskPage
      ? t(($) => $['newKnowledge.tasksWithAttention'], { count: attentionTasks.length })
      : t(($) => $['newKnowledge.tasks'])
  }${incompleteTaskHistoryHint}`
  const tasksLiveStatus = `${
    hasTaskError
      ? t(($) => $['newKnowledge.taskAttentionErrorCount'], { count: attentionTasks.length })
      : attentionTasks.length || hasNextTaskPage
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
    fetchNextDocumentPage,
    filterActive,
    tasksOpen,
    unresolvedTaskDocumentIds,
    canAutoFetchDocumentPage,
    isFetchNextDocumentPageError,
    isFetchingNextDocumentPage,
    canRead,
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
    fetchNextSourcePage,
    isFetchNextSourcePageError,
    isFetchingNextSourcePage,
    canRead,
  ])

  const refreshDocumentsAndTasks = useCallback(() => {
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
  }, [knowledgeSpaceId, queryClient])

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

  const handleReadPermissionDenied = useCallback(() => {
    setTasksOpen(false)
    setMetadataOpen(false)
  }, [setMetadataOpen])

  return (
    <>
      {streamedActiveTasks.map((task) => {
        const taskObserverVersion = observerVersion(task)
        return (
          <TaskEventObserver
            key={`${task.id}:${observerGeneration(task.id)}`}
            documentId={task.documentId}
            knowledgeSpaceId={knowledgeSpaceId}
            lastEventId={taskRuntimeState.eventCursors.get(task.id)}
            onEvent={handleTaskEvent}
            onLastEventIdChange={handleTaskEventCursor}
            onPermissionDenied={handleTaskStreamPermissionDenied}
            taskId={task.id}
            taskVersion={taskObserverVersion}
          />
        )
      })}
      <DocumentPermissionRecoveryBoundary
        bulkActionsVisible={bulkActionsVisible}
        onReadDenied={handleReadPermissionDenied}
        readSurfaceOpen={tasksOpen || metadataOpen}
        recoverySurface={recoverySurface}
      >
        <DocumentUploadSurface
          bulkActionsVisible={bulkActionsVisible}
          knowledgeSpaceId={knowledgeSpaceId}
          onUploadStarted={refreshDocumentsAndTasks}
          permission={uploadPermission}
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
                      void refetchDocumentsQuery()
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
                  void refetchDocumentsQuery()
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
                    onOpenMetadata={() => setMetadataOpen(true)}
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
                    onOpenMetadata={() => setMetadataOpen(true)}
                    onOpenTasks={() => setTasksOpen(true)}
                    onSearchChange={setSearch}
                    onSelectAll={bulkSelection.toggleAllFiltered}
                    onSelectDocument={bulkSelection.toggle}
                    onTaskUpdated={handleTaskUpdated}
                    onWriteDenied={handleWritePermissionDenied}
                    readOnlyReasonId={upload.readOnlyReasonId}
                    resultsIncomplete={filteredResultsIncomplete}
                    search={search}
                    selectionDisabled={selectionDisabled}
                    selectedDocumentIds={bulkSelection.selectedDocumentIds}
                    showTasks={Boolean(
                      tasks.length ||
                      tasksQuery.error ||
                      tasksQuery.isFetchNextPageError ||
                      hasNextTaskPage,
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
              onWriteDenied={handleWritePermissionDenied}
              selection={bulkSelection}
            />
          )}
        </DocumentPermissionRecoveryBulkRegion>
      </DocumentPermissionRecoveryBoundary>
      <ProcessingTasksDrawer
        actionResultsValid={canRead}
        canEdit={canWrite}
        documentQueryError={Boolean(documentsQuery.error || documentsQuery.isFetchNextPageError)}
        documentQueryFetching={documentsQuery.isFetching}
        documents={documents}
        documentsPending={Boolean(hasNextDocumentPage || documentsQuery.isFetchingNextPage)}
        hasNextDocumentPage={Boolean(hasNextDocumentPage)}
        hasNextTaskPage={Boolean(hasNextTaskPage)}
        hasUnresolvedTaskDocuments={unresolvedTaskDocumentIds.size > 0}
        isFetchingNextDocumentPage={isFetchingNextDocumentPage}
        isFetchingNextTaskPage={isFetchingNextTaskPage}
        knowledgeSpaceId={knowledgeSpaceId}
        onLoadMoreDocuments={() => void fetchNextDocumentPage()}
        onLoadMoreTasks={() => void fetchNextTaskPage()}
        onOpenChange={setTasksOpen}
        onRefreshDocumentsAndTasks={refreshDocumentsAndTasks}
        onRetryPermissionQuery={() => void retryWorkspacePermission()}
        onRetryDocumentQuery={() => {
          if (documentsQuery.isFetchNextPageError) void documentsQuery.fetchNextPage()
          else void refetchDocumentsQuery()
        }}
        onRetryTaskQuery={() => {
          if (tasksQuery.isFetchNextPageError) void tasksQuery.fetchNextPage()
          else void tasksQuery.refetch()
        }}
        onTaskUpdated={handleTaskUpdated}
        onWritePermissionDenied={handleWritePermissionDenied}
        open={tasksOpen && canRead}
        permissionQueryError={false}
        permissionQueryFetching={workspacePermissionRefreshing}
        permissionQueryPending={false}
        readOnlyReason={
          canWrite ? undefined : t(($) => $['newKnowledge.documentPermissionRestricted'])
        }
        sourceNames={sourceNames}
        taskQueryPending={tasksQuery.isPending}
        taskQueryError={Boolean(tasksQuery.error || tasksQuery.isFetchNextPageError)}
        taskQueryFetching={tasksQuery.isFetching}
        taskProgressStore={taskProgressStore}
        tasks={drawerTasks}
      />
      <DocumentMetadataDrawer
        knowledgeSpaceId={knowledgeSpaceId}
        onOpenChange={setMetadataOpen}
        open={metadataOpen && canRead}
        readOnly={!canWrite}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </>
  )
}
