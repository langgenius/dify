'use client'

import type { DocumentProcessingTask } from '@dify/contracts/knowledge-fs/types.gen'
import type { DocumentFilter } from './document-list'
import type { ProcessingTaskEvent } from './services/processing-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { DocumentBulkActions, DocumentsEmpty, DocumentsList } from './document-list'
import {
  documentDisplayStatus,
  newestTaskByDocument,
  sourceName,
  taskIsActive,
  taskNeedsAttention,
} from './document-model'
import { ProcessingTasksDrawer } from './processing-tasks-drawer'
import { TaskEventObserver } from './task-event-observer'

const DOCUMENT_PAGE_SIZE = 50
const TASK_PAGE_SIZE = 100
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.md,.markdown,.html,.htm,.xls,.xlsx,.txt'

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error) return error.status
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data) return data.status
  }
}

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canEdit = hasPermission(workspacePermissionKeys, DatasetACLPermission.Edit)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadPendingRef = useRef(false)
  const reindexPendingRef = useRef(false)
  const [filter, setFilter] = useState<DocumentFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set())
  const [tasksOpen, setTasksOpen] = useState(false)
  const [taskOverrides, setTaskOverrides] = useState<
    Record<string, Partial<DocumentProcessingTask>>
  >({})
  const [terminalTaskVersions, setTerminalTaskVersions] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const { mutateAsync: uploadDocument } = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocuments.mutationOptions(),
  )
  const { mutateAsync: bulkUploadDocuments } = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocumentsBulk.mutationOptions(),
  )
  const { mutateAsync: reindexDocuments } = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocumentsBulkReindex.mutationOptions(),
  )

  const documentsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdLogicalDocuments.infiniteOptions({
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: DOCUMENT_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
    }),
  )
  const tasksQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdProcessingTasks.infiniteOptions({
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: TASK_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) => page.items.some(taskIsActive)) ? 5000 : false,
    }),
  )
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.infiniteOptions({
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: TASK_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
    }),
  )
  const {
    fetchNextPage: fetchNextDocumentPage,
    hasNextPage: hasNextDocumentPage,
    isFetchNextPageError: isFetchNextDocumentPageError,
    isFetchingNextPage: isFetchingNextDocumentPage,
  } = documentsQuery
  const {
    fetchNextPage: fetchNextTaskPage,
    hasNextPage: hasNextTaskPage,
    isFetchNextPageError: isFetchNextTaskPageError,
    isFetchingNextPage: isFetchingNextTaskPage,
  } = tasksQuery
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchNextPageError: isFetchNextSourcePageError,
    isFetchingNextPage: isFetchingNextSourcePage,
  } = sourcesQuery

  const documents = useMemo(
    () =>
      documentsQuery.data?.pages
        .flatMap((page) => page.items)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
        ) ?? [],
    [documentsQuery.data],
  )
  const baseTasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [tasksQuery.data],
  )
  const sourceNames = useMemo(
    () =>
      new Map(
        (sourcesQuery.data?.pages.flatMap((page) => page.items) ?? []).map((source) => [
          source.id,
          source.name,
        ]),
      ),
    [sourcesQuery.data],
  )
  const disabledSourceIds = useMemo(
    () =>
      new Set(
        (sourcesQuery.data?.pages.flatMap((page) => page.items) ?? [])
          .filter((source) => source.status === 'disabled')
          .map((source) => source.id),
      ),
    [sourcesQuery.data],
  )
  const baseTaskUpdatedAt = useMemo(
    () => new Map(baseTasks.map((task) => [task.id, task.updatedAt])),
    [baseTasks],
  )
  const tasks = useMemo(
    () =>
      baseTasks.map((task) => {
        const override = taskOverrides[task.id]
        if (terminalTaskVersions[task.id] && override && taskIsActive(task))
          return { ...task, ...override }
        if (!override?.updatedAt) return override ? { ...task, ...override } : task
        const overrideTime = Date.parse(override.updatedAt)
        const taskTime = Date.parse(task.updatedAt)
        if (!Number.isNaN(taskTime) && !Number.isNaN(overrideTime) && taskTime > overrideTime)
          return task
        return { ...task, ...override }
      }),
    [baseTasks, taskOverrides, terminalTaskVersions],
  )
  const taskByDocument = useMemo(() => newestTaskByDocument(tasks), [tasks])
  const documentStatuses = useMemo(
    () =>
      new Map(
        documents.map((document) => [
          document.id,
          documentDisplayStatus(
            document,
            taskByDocument.get(document.id),
            Boolean(
              document.sourceId &&
              (disabledSourceIds.has(document.sourceId) || !sourceNames.has(document.sourceId)),
            ),
          ),
        ]),
      ),
    [disabledSourceIds, documents, sourceNames, taskByDocument],
  )
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const availableDocumentIds = useMemo(
    () =>
      new Set(
        documents
          .filter((document) => documentStatuses.get(document.id) !== 'disabled')
          .map((document) => document.id),
      ),
    [documents, documentStatuses],
  )
  const validSelectedDocumentIds = useMemo(
    () =>
      new Set(
        [...selectedDocumentIds].filter((documentId) => availableDocumentIds.has(documentId)),
      ),
    [availableDocumentIds, selectedDocumentIds],
  )
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
    (documentsQuery.hasNextPage || documentsQuery.isFetchingNextPage)
  const dependencyQueryError = Boolean(
    tasksQuery.error ||
    tasksQuery.isFetchNextPageError ||
    sourcesQuery.error ||
    sourcesQuery.isFetchNextPageError,
  )
  const dependencyQueriesPending = Boolean(
    tasksQuery.isPending ||
    tasksQuery.hasNextPage ||
    tasksQuery.isFetchingNextPage ||
    sourcesQuery.isPending ||
    sourcesQuery.hasNextPage ||
    sourcesQuery.isFetchingNextPage,
  )
  const selectableFilteredDocuments = filteredDocuments.filter(
    (document) => documentStatuses.get(document.id) !== 'disabled',
  )
  const attentionTasks = tasks.filter(taskNeedsAttention)
  const hasTaskError = attentionTasks.some(
    (task) => task.state === 'failed' || task.state === 'canceled',
  )
  const activeTasks = tasks.filter(taskIsActive)
  const tasksButtonLabel = attentionTasks.length
    ? t(($) => $['newKnowledge.tasksWithAttention'], { count: attentionTasks.length })
    : t(($) => $['newKnowledge.tasks'])
  const tasksLiveStatus = hasTaskError
    ? t(($) => $['newKnowledge.taskAttentionErrorCount'], { count: attentionTasks.length })
    : attentionTasks.length
      ? t(($) => $['newKnowledge.taskAttentionCount'], { count: attentionTasks.length })
      : t(($) => $['newKnowledge.taskAttentionClear'])
  const allFilteredSelected =
    selectableFilteredDocuments.length > 0 &&
    selectableFilteredDocuments.every((document) => validSelectedDocumentIds.has(document.id))
  const someFilteredSelected = selectableFilteredDocuments.some((document) =>
    validSelectedDocumentIds.has(document.id),
  )

  useEffect(() => {
    if (
      filterActive &&
      hasNextDocumentPage &&
      !isFetchingNextDocumentPage &&
      !isFetchNextDocumentPageError
    )
      void fetchNextDocumentPage()
  }, [
    fetchNextDocumentPage,
    filterActive,
    hasNextDocumentPage,
    isFetchNextDocumentPageError,
    isFetchingNextDocumentPage,
  ])

  useEffect(() => {
    if (hasNextTaskPage && !isFetchingNextTaskPage && !isFetchNextTaskPageError)
      void fetchNextTaskPage()
  }, [fetchNextTaskPage, hasNextTaskPage, isFetchNextTaskPageError, isFetchingNextTaskPage])

  useEffect(() => {
    if (hasNextSourcePage && !isFetchingNextSourcePage && !isFetchNextSourcePageError)
      void fetchNextSourcePage()
  }, [fetchNextSourcePage, hasNextSourcePage, isFetchNextSourcePageError, isFetchingNextSourcePage])

  const refreshDocumentsAndTasks = useCallback(() => {
    void Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdLogicalDocuments.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdProcessingTasks.key(),
      }),
    ])
  }, [queryClient])

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canEdit || !files.length || uploadPendingRef.current) return
      uploadPendingRef.current = true
      setUploading(true)
      try {
        if (files.length === 1) {
          await uploadDocument({
            body: { file: files[0]! },
            params: { id: knowledgeSpaceId },
          })
        } else {
          const result = await bulkUploadDocuments({
            body: { files },
            params: { id: knowledgeSpaceId },
          })
          if (!result.accepted) {
            toast.error(t(($) => $['newKnowledge.documentUploadRejected']))
            return
          }
          if (result.excluded)
            toast.warning(
              t(($) => $['newKnowledge.documentUploadPartial'], {
                accepted: result.accepted,
                excluded: result.excluded,
              }),
            )
          else toast.success(t(($) => $['newKnowledge.documentUploadStarted']))
          refreshDocumentsAndTasks()
          return
        }
        toast.success(t(($) => $['newKnowledge.documentUploadStarted']))
        refreshDocumentsAndTasks()
      } catch {
        toast.error(t(($) => $['newKnowledge.documentUploadFailed']))
      } finally {
        uploadPendingRef.current = false
        setUploading(false)
      }
    },
    [bulkUploadDocuments, canEdit, knowledgeSpaceId, refreshDocumentsAndTasks, t, uploadDocument],
  )

  const handleReindexDocuments = useCallback(async () => {
    if (!canEdit || !validSelectedDocumentIds.size || reindexPendingRef.current) return
    reindexPendingRef.current = true
    setReindexing(true)
    try {
      const selectedIds = [...validSelectedDocumentIds].sort()
      const result = await reindexDocuments({
        body: { documentIds: selectedIds },
        params: { id: knowledgeSpaceId },
      })
      const missingIds = result.items
        .filter((item) => item.status === 'not_found')
        .map((item) => item.documentId)
      const queuedCount = result.items.length - missingIds.length
      if (!queuedCount) {
        toast.error(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: missingIds.length,
            queued: 0,
          }),
        )
        return
      }
      setSelectedDocumentIds(new Set(missingIds))
      if (missingIds.length)
        toast.warning(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: missingIds.length,
            queued: queuedCount,
          }),
        )
      else toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
      refreshDocumentsAndTasks()
    } catch {
      toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
    } finally {
      reindexPendingRef.current = false
      setReindexing(false)
    }
  }, [
    canEdit,
    knowledgeSpaceId,
    refreshDocumentsAndTasks,
    reindexDocuments,
    t,
    validSelectedDocumentIds,
  ])

  const handleTaskEvent = useCallback(
    (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => {
      setTaskOverrides((current) => {
        const previous = current[taskId]
        if (
          event.event === 'progress' &&
          previous?.updatedAt &&
          Date.parse(previous.updatedAt) > Date.parse(event.data.updatedAt)
        )
          return current
        return {
          ...current,
          [taskId]:
            event.event === 'progress'
              ? {
                  progressPercent: event.data.progressPercent,
                  stage: event.data.stage,
                  state: event.data.state,
                  updatedAt: event.data.updatedAt,
                }
              : {
                  errorCode: event.data.errorCode,
                  ...(event.data.state === 'failed' ? {} : { errorMessage: undefined }),
                  state: event.data.state,
                  updatedAt: previous?.updatedAt ?? taskVersion,
                },
        }
      })
      if (event.event === 'terminal') {
        setTerminalTaskVersions((current) => ({ ...current, [taskId]: taskVersion }))
        if (event.data.state === 'failed')
          toast.error(t(($) => $['newKnowledge.taskFailedNotification']))
        refreshDocumentsAndTasks()
      }
    },
    [refreshDocumentsAndTasks, t],
  )

  const handleTaskUpdated = useCallback((task: DocumentProcessingTask) => {
    setTaskOverrides((current) => ({ ...current, [task.id]: task }))
    if (taskIsActive(task))
      setTerminalTaskVersions((current) => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
  }, [])

  const toggleDocument = useCallback(
    (documentId: string) => {
      if (!canEdit || completingFilteredResults) return
      setSelectedDocumentIds((current) => {
        const next = new Set(current)
        if (next.has(documentId)) next.delete(documentId)
        else next.add(documentId)
        return next
      })
    },
    [canEdit, completingFilteredResults],
  )

  const toggleAllFiltered = () => {
    if (!canEdit || completingFilteredResults) return
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected)
        selectableFilteredDocuments.forEach((document) => next.delete(document.id))
      else selectableFilteredDocuments.forEach((document) => next.add(document.id))
      return next
    })
  }

  const retryDependencyQueries = () => {
    if (tasksQuery.isFetchNextPageError) void tasksQuery.fetchNextPage()
    else if (tasksQuery.error) void tasksQuery.refetch()
    if (sourcesQuery.isFetchNextPageError) void sourcesQuery.fetchNextPage()
    else if (sourcesQuery.error) void sourcesQuery.refetch()
  }

  return (
    <>
      {activeTasks.map((task) => (
        <TaskEventObserver
          key={task.id}
          documentId={task.documentId}
          knowledgeSpaceId={knowledgeSpaceId}
          onError={refreshDocumentsAndTasks}
          onEvent={handleTaskEvent}
          taskId={task.id}
          taskVersion={baseTaskUpdatedAt.get(task.id) ?? task.updatedAt}
        />
      ))}
      {canEdit && (
        <input
          ref={uploadInputRef}
          multiple
          hidden
          accept={DOCUMENT_ACCEPT}
          aria-label={t(($) => $['newKnowledge.uploadDocuments'])}
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ''
            void handleUploadFiles(files)
          }}
        />
      )}
      {!canEdit && (
        <span id="documents-readonly-reason" className="sr-only">
          {t(($) => $['newKnowledge.permissionRestricted'])}
        </span>
      )}
      <main className="flex min-h-full flex-col px-4 py-6 sm:px-8 sm:py-7">
        <header>
          <h2 className="title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.documents'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.documentsDescription'])}
          </p>
        </header>
        {documentsQuery.isPending ? (
          <div className="flex min-h-64 flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : documentsQuery.error && !documentsQuery.data ? (
          <div
            className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
            <h2 className="mt-3 title-xl-semi-bold text-text-primary">
              {t(($) =>
                responseStatus(documentsQuery.error) === 403
                  ? $['newKnowledge.documentsPermissionTitle']
                  : $['newKnowledge.documentsErrorTitle'],
              )}
            </h2>
            <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
              {t(($) =>
                responseStatus(documentsQuery.error) === 403
                  ? $['newKnowledge.documentsPermissionDescription']
                  : $['newKnowledge.documentsErrorDescription'],
              )}
            </p>
            {responseStatus(documentsQuery.error) !== 403 && (
              <Button className="mt-4" onClick={() => void documentsQuery.refetch()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            )}
          </div>
        ) : dependencyQueryError ? (
          <div
            className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
            <p className="mt-3 max-w-md body-sm-regular text-text-tertiary">
              {sourcesQuery.error || sourcesQuery.isFetchNextPageError
                ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                : t(($) => $['newKnowledge.tasksErrorDescription'])}
            </p>
            <Button className="mt-4" onClick={retryDependencyQueries}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        ) : dependencyQueriesPending ? (
          <div className="flex min-h-64 flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : !documents.length ? (
          <DocumentsEmpty
            canEdit={canEdit}
            onAddDocument={() => uploadInputRef.current?.click()}
            onDropFiles={(files) => void handleUploadFiles(files)}
            readOnlyReasonId="documents-readonly-reason"
            uploading={uploading}
          />
        ) : (
          <DocumentsList
            activeTaskCount={activeTasks.length}
            allSelected={allFilteredSelected}
            attentionTaskCount={attentionTasks.length}
            canEdit={canEdit}
            completingResults={completingFilteredResults}
            documents={filteredDocuments}
            filter={filter}
            hasNextPage={Boolean(documentsQuery.hasNextPage)}
            hasSelectableDocuments={Boolean(selectableFilteredDocuments.length)}
            hasTaskError={hasTaskError}
            isFetchNextPageError={documentsQuery.isFetchNextPageError}
            isFetchingNextPage={documentsQuery.isFetchingNextPage}
            onAddDocument={() => uploadInputRef.current?.click()}
            onFilterChange={setFilter}
            onLoadMore={() => void documentsQuery.fetchNextPage()}
            onOpenTasks={() => setTasksOpen(true)}
            onSearchChange={setSearch}
            onSelectAll={toggleAllFiltered}
            onSelectDocument={toggleDocument}
            search={search}
            selectionDisabled={completingFilteredResults}
            selectedDocumentIds={validSelectedDocumentIds}
            someSelected={someFilteredSelected}
            sourceNames={sourceNames}
            statuses={documentStatuses}
            tasksButtonLabel={tasksButtonLabel}
            tasksLiveStatus={tasksLiveStatus}
            uploading={uploading}
          />
        )}
      </main>
      {canEdit && !!validSelectedDocumentIds.size && (
        <DocumentBulkActions
          disabled={completingFilteredResults}
          onClear={() => setSelectedDocumentIds(new Set())}
          onReindex={() => void handleReindexDocuments()}
          reindexing={reindexing}
          selectedCount={validSelectedDocumentIds.size}
        />
      )}
      <ProcessingTasksDrawer
        canEdit={canEdit}
        documents={documents}
        knowledgeSpaceId={knowledgeSpaceId}
        onOpenChange={setTasksOpen}
        onRetryTaskQuery={() => void tasksQuery.refetch()}
        onTaskUpdated={handleTaskUpdated}
        open={tasksOpen}
        taskQueryPending={tasksQuery.isPending}
        taskQueryError={Boolean(tasksQuery.error)}
        tasks={tasks}
      />
    </>
  )
}
