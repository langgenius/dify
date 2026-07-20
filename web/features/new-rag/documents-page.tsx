'use client'

import type { DocumentProcessingTask } from '@dify/contracts/knowledge-fs/types.gen'
import type { DocumentFilter } from './document-list'
import type { ProcessingTaskEvent } from './services/processing-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
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
        if (!override?.updatedAt) return override ? { ...task, ...override } : task
        const overrideTime = Date.parse(override.updatedAt)
        const taskTime = Date.parse(task.updatedAt)
        if (!Number.isNaN(taskTime) && !Number.isNaN(overrideTime) && taskTime > overrideTime)
          return task
        return { ...task, ...override }
      }),
    [baseTasks, taskOverrides],
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
            Boolean(document.sourceId && disabledSourceIds.has(document.sourceId)),
          ),
        ]),
      ),
    [disabledSourceIds, documents, taskByDocument],
  )
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const availableDocumentIds = useMemo(
    () => new Set(documents.map((document) => document.id)),
    [documents],
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
    filteredDocuments.length > 0 &&
    filteredDocuments.every((document) => validSelectedDocumentIds.has(document.id))
  const someFilteredSelected = filteredDocuments.some((document) =>
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
      if (!files.length || uploadPendingRef.current) return
      uploadPendingRef.current = true
      setUploading(true)
      try {
        if (files.length === 1) {
          await uploadDocument({
            body: { file: files[0]! },
            params: { id: knowledgeSpaceId },
          })
        } else {
          await bulkUploadDocuments({
            body: { files },
            params: { id: knowledgeSpaceId },
          })
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
    [bulkUploadDocuments, knowledgeSpaceId, refreshDocumentsAndTasks, t, uploadDocument],
  )

  const handleReindexDocuments = useCallback(async () => {
    if (!validSelectedDocumentIds.size || reindexPendingRef.current) return
    reindexPendingRef.current = true
    setReindexing(true)
    try {
      await reindexDocuments({
        body: { documentIds: [...validSelectedDocumentIds].sort() },
        params: { id: knowledgeSpaceId },
      })
      setSelectedDocumentIds(new Set())
      toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
      refreshDocumentsAndTasks()
    } catch {
      toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
    } finally {
      reindexPendingRef.current = false
      setReindexing(false)
    }
  }, [knowledgeSpaceId, refreshDocumentsAndTasks, reindexDocuments, t, validSelectedDocumentIds])

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
        if (event.data.state === 'failed')
          toast.error(t(($) => $['newKnowledge.taskFailedNotification']))
        refreshDocumentsAndTasks()
      }
    },
    [refreshDocumentsAndTasks, t],
  )

  const handleTaskUpdated = useCallback((task: DocumentProcessingTask) => {
    setTaskOverrides((current) => ({ ...current, [task.id]: task }))
  }, [])

  const toggleDocument = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }, [])

  const toggleAllFiltered = () => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected) filteredDocuments.forEach((document) => next.delete(document.id))
      else filteredDocuments.forEach((document) => next.add(document.id))
      return next
    })
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
      <input
        ref={uploadInputRef}
        multiple
        accept={DOCUMENT_ACCEPT}
        aria-label={t(($) => $['newKnowledge.uploadDocuments'])}
        className="sr-only"
        type="file"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          event.currentTarget.value = ''
          void handleUploadFiles(files)
        }}
      />
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
        ) : !documents.length ? (
          <DocumentsEmpty
            onAddDocument={() => uploadInputRef.current?.click()}
            onDropFiles={(files) => void handleUploadFiles(files)}
            uploading={uploading}
          />
        ) : (
          <DocumentsList
            activeTaskCount={activeTasks.length}
            allSelected={allFilteredSelected}
            attentionTaskCount={attentionTasks.length}
            completingResults={completingFilteredResults}
            documents={filteredDocuments}
            filter={filter}
            hasNextPage={Boolean(documentsQuery.hasNextPage)}
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
      {!!validSelectedDocumentIds.size && (
        <DocumentBulkActions
          onClear={() => setSelectedDocumentIds(new Set())}
          onReindex={() => void handleReindexDocuments()}
          reindexing={reindexing}
          selectedCount={validSelectedDocumentIds.size}
        />
      )}
      <ProcessingTasksDrawer
        documents={documents}
        knowledgeSpaceId={knowledgeSpaceId}
        onOpenChange={setTasksOpen}
        onRetryTaskQuery={() => void tasksQuery.refetch()}
        onTaskUpdated={handleTaskUpdated}
        open={tasksOpen}
        taskQueryError={Boolean(tasksQuery.error)}
        tasks={tasks}
      />
    </>
  )
}
