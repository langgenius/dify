'use client'

import type {
  DocumentProcessingTask,
  LogicalDocument,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { DocumentDisplayStatus } from './document-model'
import type { ProcessingTaskEvent } from './services/processing-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import {
  documentDisplayStatus,
  newestTaskByDocument,
  sourceName,
  taskIsActive,
  taskNeedsAttention,
} from './document-model'
import { ProcessingTasksDrawer } from './processing-tasks-drawer'
import { streamProcessingTaskEvents } from './services/processing-task-events'

type DocumentFilter = DocumentDisplayStatus | 'all'

const DOCUMENT_PAGE_SIZE = 50
const TASK_PAGE_SIZE = 100
const TASK_EVENT_RECONNECT_DELAY = 1000
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.md,.markdown,.html,.htm,.xls,.xlsx,.txt'

const statusIconClass: Record<DocumentDisplayStatus, string> = {
  ready: 'i-ri-check-line text-text-success',
  queued: 'i-ri-time-line text-text-tertiary',
  processing: 'i-ri-loader-2-line animate-spin text-text-accent',
  failed: 'i-ri-error-warning-fill text-text-destructive',
  disabled: 'i-ri-indeterminate-circle-line text-text-tertiary',
}

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error) return error.status
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data) return data.status
  }
}

function waitForTaskEventReconnect(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, TASK_EVENT_RECONNECT_DELAY)
    signal.addEventListener('abort', finish, { once: true })

    function finish() {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}

function TaskEventObserver({
  documentId,
  knowledgeSpaceId,
  onError,
  onEvent,
  taskId,
  taskVersion,
}: {
  documentId: string
  knowledgeSpaceId: string
  onError: () => void
  onEvent: (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => void
  taskId: string
  taskVersion: string
}) {
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      let lastEventId: string | undefined
      while (!controller.signal.aborted) {
        try {
          for await (const event of streamProcessingTaskEvents({
            documentId,
            knowledgeSpaceId,
            lastEventId,
            signal: controller.signal,
            taskId,
          })) {
            if (controller.signal.aborted) return
            lastEventId = event.id
            onEvent(taskId, taskVersion, event)
            if (event.event === 'terminal') return
          }
        } catch {
          if (controller.signal.aborted) return
        }
        onError()
        await waitForTaskEventReconnect(controller.signal)
      }
    })()
    return () => controller.abort()
  }, [documentId, knowledgeSpaceId, onError, onEvent, taskId, taskVersion])

  return null
}

const DocumentRow = memo(
  ({
    document,
    formatTimeFromNow,
    onSelectedChange,
    selected,
    source,
    status,
  }: {
    document: LogicalDocument
    formatTimeFromNow: (time: number) => string
    onSelectedChange: (documentId: string) => void
    selected: boolean
    source?: string
    status: DocumentDisplayStatus
  }) => {
    const { t } = useTranslation('dataset')
    const titleId = `new-document-${document.id}`
    const revision = document.activeRevision ?? document.active?.revision
    const updatedTime = Date.parse(document.updatedAt)

    return (
      <tr className={cn('border-t border-divider-subtle', status === 'disabled' && 'opacity-60')}>
        <td className="w-10 py-3 pr-3">
          <Checkbox
            checked={selected}
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
          <span className="block truncate">
            {source ?? t(($) => $['newKnowledge.manualUpload'])}
          </span>
        </td>
        <td className="w-56 py-3 pr-6">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 system-xs-regular',
              status === 'failed' ? 'text-text-destructive' : 'text-text-secondary',
            )}
          >
            <span aria-hidden className={cn('size-3.5', statusIconClass[status])} />
            {t(($) => $[`newKnowledge.documentStatus.${status}`])}
          </span>
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

function DocumentsEmpty({
  onAddDocument,
  onDropFiles,
  uploading,
}: {
  onAddDocument: () => void
  onDropFiles: (files: File[]) => void
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  return (
    <div
      className="flex min-h-96 flex-1 flex-col items-center justify-center px-6 text-center"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDropFiles([...event.dataTransfer.files])
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
      <Button className="mt-4" variant="primary" loading={uploading} onClick={onAddDocument}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['newKnowledge.addDocument'])}
      </Button>
      <p className="mt-2 system-2xs-regular text-text-quaternary">
        {t(($) => $['newKnowledge.documentsDropHint'])}
      </p>
    </div>
  )
}

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
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
          <>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="sr-only" htmlFor="document-filter">
                {t(($) => $['newKnowledge.documentFilterLabel'])}
              </label>
              <select
                id="document-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value as DocumentFilter)}
                className="h-8 rounded-lg border-0 bg-components-input-bg-normal px-3 system-xs-regular text-text-secondary outline-hidden focus:ring-2 focus:ring-state-accent-solid sm:w-36"
              >
                <option value="all">{t(($) => $['newKnowledge.allDocumentStatuses'])}</option>
                {(['ready', 'queued', 'processing', 'failed', 'disabled'] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {t(($) => $[`newKnowledge.documentStatus.${status}`])}
                    </option>
                  ),
                )}
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
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t(($) => $['newKnowledge.searchDocuments'])}
                  className="h-8 w-full rounded-lg border-0 bg-components-input-bg-normal pr-3 pl-8 system-xs-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
                />
              </label>
              <span className="min-w-0 flex-1" />
              <Button
                aria-label={tasksButtonLabel}
                data-has-error={hasTaskError ? 'true' : 'false'}
                onClick={() => setTasksOpen(true)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4',
                    activeTasks.length ? 'i-ri-loader-2-line animate-spin' : 'i-ri-task-line',
                  )}
                />
                {t(($) => $['newKnowledge.tasks'])}
                {!!attentionTasks.length && (
                  <span
                    aria-hidden
                    className={cn(
                      'flex min-w-4 items-center justify-center rounded px-1 system-2xs-medium',
                      hasTaskError
                        ? 'bg-state-destructive-hover text-text-destructive'
                        : 'bg-state-accent-hover text-text-accent',
                    )}
                  >
                    {attentionTasks.length}
                  </span>
                )}
              </Button>
              <span className="sr-only" role="status" aria-live="polite">
                {tasksLiveStatus}
              </span>
              <Button disabled title={t(($) => $['newKnowledge.documentActionsUnavailable'])}>
                <span aria-hidden className="i-ri-price-tag-3-line size-4" />
                {t(($) => $['newKnowledge.metadata'])}
              </Button>
              <Button
                variant="primary"
                loading={uploading}
                onClick={() => uploadInputRef.current?.click()}
              >
                <span aria-hidden className="i-ri-add-line size-4" />
                {t(($) => $['newKnowledge.addDocument'])}
              </Button>
            </div>
            <div
              aria-busy={completingFilteredResults || documentsQuery.isFetchingNextPage}
              className="mt-4 overflow-x-auto"
            >
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="system-2xs-medium text-text-tertiary uppercase">
                  <tr>
                    <th className="pb-2 font-medium">
                      <Checkbox
                        checked={allFilteredSelected}
                        indeterminate={someFilteredSelected && !allFilteredSelected}
                        disabled={!filteredDocuments.length}
                        aria-label={t(($) => $['newKnowledge.selectAllDocuments'])}
                        onCheckedChange={toggleAllFiltered}
                      />
                    </th>
                    <th className="pb-2 font-medium">
                      {t(($) => $['newKnowledge.documentColumn'])}
                    </th>
                    <th className="pb-2 font-medium">{t(($) => $['newKnowledge.sourceColumn'])}</th>
                    <th className="pb-2 font-medium">{t(($) => $['newKnowledge.statusColumn'])}</th>
                    <th className="pb-2 font-medium">
                      {t(($) => $['newKnowledge.updatedColumn'])}
                    </th>
                    <th aria-label={t(($) => $['newKnowledge.actionsColumn'])} />
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      formatTimeFromNow={formatTimeFromNow}
                      onSelectedChange={toggleDocument}
                      selected={validSelectedDocumentIds.has(document.id)}
                      source={
                        (document.sourceId && sourceNames.get(document.sourceId)) ??
                        sourceName(document)
                      }
                      status={documentStatuses.get(document.id) ?? 'queued'}
                    />
                  ))}
                </tbody>
              </table>
              {!filteredDocuments.length &&
                !completingFilteredResults &&
                !documentsQuery.isFetchNextPageError && (
                  <p
                    aria-live="polite"
                    className="py-16 text-center body-sm-regular text-text-tertiary"
                    role="status"
                  >
                    {t(($) => $['newKnowledge.noMatchingDocuments'])}
                  </p>
                )}
              {completingFilteredResults && (
                <div className="flex min-h-32 items-center justify-center">
                  <Loading />
                </div>
              )}
            </div>
            <p className="mt-3 flex items-center gap-1.5 system-xs-regular text-text-tertiary">
              <span aria-hidden className="i-ri-information-2-line size-3.5" />
              {t(($) => $['newKnowledge.lastReadyRevisionHint'])}
            </p>
            {documentsQuery.isFetchNextPageError ? (
              <div className="mt-5 flex items-center justify-center gap-3" role="alert">
                <span className="system-xs-regular text-text-destructive">
                  {t(($) => $['newKnowledge.documentsErrorDescription'])}
                </span>
                <Button onClick={() => void documentsQuery.fetchNextPage()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            ) : documentsQuery.hasNextPage && !filterActive ? (
              <div className="mt-5 flex justify-center">
                <Button
                  loading={documentsQuery.isFetchingNextPage}
                  onClick={() => void documentsQuery.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </main>
      {!!validSelectedDocumentIds.size && (
        <div
          aria-label={t(($) => $['newKnowledge.bulkDocumentActions'])}
          className="fixed bottom-7 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[14px] border border-divider-subtle bg-components-panel-bg px-3 py-2.5 shadow-xl"
          role="toolbar"
        >
          <span className="px-1 system-xs-medium text-text-primary">
            {t(($) => $['newKnowledge.documentsSelected'], {
              count: validSelectedDocumentIds.size,
            })}
          </span>
          <span id="document-actions-unavailable" className="sr-only">
            {t(($) => $['newKnowledge.documentActionsUnavailable'])}
          </span>
          <Button size="small" loading={reindexing} onClick={() => void handleReindexDocuments()}>
            {t(($) => $['newKnowledge.reindexDocuments'])}
          </Button>
          <Button size="small" disabled aria-describedby="document-actions-unavailable">
            {t(($) => $['newKnowledge.downloadDocuments'])}
          </Button>
          <Button size="small" disabled aria-describedby="document-actions-unavailable">
            {t(($) => $['newKnowledge.deleteDocuments'])}
          </Button>
          <button
            type="button"
            aria-label={t(($) => $['newKnowledge.clearDocumentSelection'])}
            className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setSelectedDocumentIds(new Set())}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
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
