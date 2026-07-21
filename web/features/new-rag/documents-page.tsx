'use client'

import type { DocumentProcessingTask } from '@dify/contracts/knowledge-fs/types.gen'
import type { DocumentFilter } from './document-list'
import type {
  ProcessingTaskEvent,
  ProcessingTaskProgressEvent,
} from './services/processing-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  datasetDefaultPermissionKeysAtom,
  retryWorkspacePermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { consoleClient, consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { DocumentBulkActions, DocumentsEmpty, DocumentsList } from './document-list'
import {
  ACTIVE_TASK_STATES,
  documentDisplayStatus,
  newestTaskByDocument,
  sourceName,
  taskIsActive,
  taskNeedsAttention,
} from './document-model'
import { ProcessingTasksDrawer } from './processing-tasks-drawer'
import { TaskEventObserver } from './task-event-observer'
import { createTaskProgressStore } from './task-progress-store'

const DOCUMENT_PAGE_SIZE = 50
const TASK_PAGE_SIZE = 100
const MAX_TASK_EVENT_STREAMS = 6
const MAX_AUTO_CURSOR_PAGES = 20
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.md,.markdown,.html,.htm,.xls,.xlsx,.txt'

const uploadExclusionReasonKey = {
  batch_byte_limit_exceeded: 'batchLimit',
  document_not_found: 'target',
  file_count_limit_exceeded: 'countLimit',
  file_too_large: 'fileSize',
  invalid_file: 'fileType',
  invalid_target: 'target',
  processing_failed: 'processing',
  quota_exceeded: 'quota',
  revision_conflict: 'target',
  unsupported_mime_type: 'fileType',
} as const

type TerminalTaskPin = {
  observedAt: string
  taskListGeneration: number
}

function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function taskSnapshotErrorIsTransient(error: unknown) {
  const status = responseStatus(error)
  return status === undefined || status === 408 || status === 429 || status >= 500
}

function taskVersionIsAfter(candidate: string, baseline: string) {
  const candidateTime = Date.parse(candidate)
  const baselineTime = Date.parse(baseline)
  if (!Number.isNaN(candidateTime) && !Number.isNaN(baselineTime))
    return candidateTime > baselineTime

  return candidate.localeCompare(baseline) > 0
}

function normalizedTaskSnapshot(task: DocumentProcessingTask): DocumentProcessingTask {
  return {
    ...task,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
  }
}

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const retryWorkspacePermissionKeys = useSetAtom(retryWorkspacePermissionKeysAtom)
  const canEdit = hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.Edit)
  const permissionPending = workspacePermissionKeysLoading
  const permissionQueryError = Boolean(workspacePermissionKeysError)
  const canWrite = canEdit && !permissionPending && !permissionQueryError
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadPendingRef = useRef(false)
  const reindexPendingRef = useRef(false)
  const [filter, setFilter] = useState<DocumentFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set())
  const [tasksOpen, setTasksOpen] = useState(false)
  const [taskStreamOffset, setTaskStreamOffset] = useState(0)
  const failedTaskPollOffsetRef = useRef(0)
  const [taskOverrides, setTaskOverrides] = useState<
    Record<string, Partial<DocumentProcessingTask>>
  >({})
  const [terminalTaskPins, setTerminalTaskPins] = useState<Record<string, TerminalTaskPin>>({})
  const [taskObserverGenerations, setTaskObserverGenerations] = useState<Record<string, number>>({})
  const terminalReconciliationGenerationsRef = useRef(new Map<string, number>())
  const failedTaskPollGenerationsRef = useRef(new Map<string, number>())
  const blockedFailedTaskPollsRef = useRef(new Set<string>())
  const equalRetryListGenerationsRef = useRef(new Map<string, number>())
  const terminalReconciliationTimeoutsRef = useRef(new Map<string, number>())
  const terminalReconciliationControllersRef = useRef(new Map<string, AbortController>())
  const pendingTerminalProgressRef = useRef(new Map<string, ProcessingTaskProgressEvent>())
  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
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
  const canAutoFetchDocumentPage = Boolean(
    hasNextDocumentPage && (documentsQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const canAutoFetchTaskPage = Boolean(
    hasNextTaskPage && (tasksQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const canAutoFetchSourcePage = Boolean(
    hasNextSourcePage && (sourcesQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data],
  )
  const baseTasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [tasksQuery.data],
  )
  const taskListSnapshotRef = useRef(tasksQuery.data)
  const taskListGenerationRef = useRef(0)
  if (taskListSnapshotRef.current !== tasksQuery.data) {
    taskListSnapshotRef.current = tasksQuery.data
    taskListGenerationRef.current += 1
  }
  const taskListGeneration = taskListGenerationRef.current
  const baseTaskById = useMemo(() => new Map(baseTasks.map((task) => [task.id, task])), [baseTasks])
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
  const baseTaskByIdRef = useRef(baseTaskById)
  baseTaskByIdRef.current = baseTaskById
  const baseTaskUpdatedAtRef = useRef(baseTaskUpdatedAt)
  baseTaskUpdatedAtRef.current = baseTaskUpdatedAt
  const tasks = useMemo(
    () =>
      baseTasks.map((task) => {
        const override = taskOverrides[task.id]
        const terminalTaskPin = terminalTaskPins[task.id]
        if (
          terminalTaskPin &&
          override &&
          taskIsActive(task) &&
          !taskVersionIsAfter(task.updatedAt, terminalTaskPin.observedAt)
        )
          return { ...task, ...override }
        if (!override?.updatedAt) return override ? { ...task, ...override } : task
        const overrideTime = Date.parse(override.updatedAt)
        const taskTime = Date.parse(task.updatedAt)
        if (!Number.isNaN(taskTime) && !Number.isNaN(overrideTime) && taskTime > overrideTime)
          return task
        return { ...task, ...override }
      }),
    [baseTasks, taskOverrides, terminalTaskPins],
  )
  const currentTaskStateRef = useRef(new Map(tasks.map((task) => [task.id, task.state])))
  currentTaskStateRef.current = new Map(tasks.map((task) => [task.id, task.state]))

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
              (disabledSourceIds.has(document.sourceId) ||
                (!hasNextSourcePage && !sourceNames.has(document.sourceId))),
            ),
          ),
        ]),
      ),
    [disabledSourceIds, documents, hasNextSourcePage, sourceNames, taskByDocument],
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
    (canAutoFetchDocumentPage || documentsQuery.isFetchingNextPage)
  const filteredResultsIncomplete = Boolean(
    filterActive &&
    (hasNextDocumentPage ||
      documentsQuery.isFetchingNextPage ||
      documentsQuery.isFetchNextPageError),
  )
  const dependencyQueryBlockingError = Boolean(
    (tasksQuery.error && !tasksQuery.data) || (sourcesQuery.error && !sourcesQuery.data),
  )
  const dependencyQueryWarning = Boolean(
    (tasksQuery.error && tasksQuery.data) ||
    tasksQuery.isFetchNextPageError ||
    (sourcesQuery.error && sourcesQuery.data) ||
    sourcesQuery.isFetchNextPageError,
  )
  const taskResultsIncomplete = Boolean(
    !tasksQuery.data ||
    tasksQuery.isPending ||
    hasNextTaskPage ||
    tasksQuery.isFetchingNextPage ||
    tasksQuery.isFetchNextPageError,
  )
  const sourceResultsIncomplete = Boolean(
    !sourcesQuery.data ||
    sourcesQuery.isPending ||
    hasNextSourcePage ||
    sourcesQuery.isFetchingNextPage ||
    sourcesQuery.isFetchNextPageError,
  )
  const dependencyResultsIncomplete = taskResultsIncomplete || sourceResultsIncomplete
  const selectionDisabled =
    !canWrite || dependencyResultsIncomplete || dependencyQueryWarning || filteredResultsIncomplete
  const selectableFilteredDocuments = filteredDocuments.filter(
    (document) => documentStatuses.get(document.id) !== 'disabled',
  )
  const attentionTasks = tasks.filter(taskNeedsAttention)
  const hasTaskError = attentionTasks.some(
    (task) => task.state === 'failed' || task.state === 'canceled',
  )
  const activeTasks = useMemo(() => tasks.filter(taskIsActive), [tasks])
  const orderedActiveTasks = useMemo(
    () =>
      [...activeTasks].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    [activeTasks],
  )
  const streamedActiveTasks = useMemo(() => {
    const streamCount = Math.min(MAX_TASK_EVENT_STREAMS, orderedActiveTasks.length)
    if (!streamCount) return []
    const offset = taskStreamOffset % orderedActiveTasks.length
    return Array.from(
      { length: streamCount },
      (_, index) => orderedActiveTasks[(offset + index) % orderedActiveTasks.length]!,
    )
  }, [orderedActiveTasks, taskStreamOffset])
  const orderedFailedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.state === 'failed')
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
        ),
    [tasks],
  )
  const orderedFailedTasksRef = useRef(orderedFailedTasks)
  orderedFailedTasksRef.current = orderedFailedTasks
  const failedTaskPollSignature = orderedFailedTasks
    .map((task) => `${task.id}:${task.updatedAt}`)
    .join('|')
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
    if (orderedActiveTasks.length <= MAX_TASK_EVENT_STREAMS) return
    const interval = window.setInterval(
      () => setTaskStreamOffset((current) => current + MAX_TASK_EVENT_STREAMS),
      5000,
    )
    return () => window.clearInterval(interval)
  }, [orderedActiveTasks.length])

  useEffect(() => {
    if (
      filterActive &&
      canAutoFetchDocumentPage &&
      !isFetchingNextDocumentPage &&
      !isFetchNextDocumentPageError
    )
      void fetchNextDocumentPage()
  }, [
    fetchNextDocumentPage,
    filterActive,
    canAutoFetchDocumentPage,
    isFetchNextDocumentPageError,
    isFetchingNextDocumentPage,
  ])

  useEffect(() => {
    if (canAutoFetchTaskPage && !isFetchingNextTaskPage && !isFetchNextTaskPageError)
      void fetchNextTaskPage()
  }, [canAutoFetchTaskPage, fetchNextTaskPage, isFetchNextTaskPageError, isFetchingNextTaskPage])

  useEffect(() => {
    if (canAutoFetchSourcePage && !isFetchingNextSourcePage && !isFetchNextSourcePageError)
      void fetchNextSourcePage()
  }, [
    canAutoFetchSourcePage,
    fetchNextSourcePage,
    isFetchNextSourcePageError,
    isFetchingNextSourcePage,
  ])

  const refreshDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdLogicalDocuments.key(),
    })
  }, [queryClient])

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

  const reconcileTerminalTask = useCallback(
    async function reconcileTerminalTaskRequest(
      taskId: string,
      terminalVersion: string,
      reconciliationGeneration: number,
      retryAttempt = 0,
    ) {
      const currentTask = baseTaskByIdRef.current.get(taskId)
      if (!currentTask) return
      terminalReconciliationControllersRef.current.get(taskId)?.abort()
      const controller = new AbortController()
      terminalReconciliationControllersRef.current.set(taskId, controller)
      try {
        const snapshot =
          await consoleClient.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId(
            {
              params: {
                documentId: currentTask.documentId,
                id: knowledgeSpaceId,
                taskId,
              },
            },
            { signal: controller.signal },
          )
        if (
          terminalReconciliationControllersRef.current.get(taskId) !== controller ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration
        )
          return
        terminalReconciliationControllersRef.current.delete(taskId)
        if (taskVersionIsAfter(terminalVersion, snapshot.updatedAt)) return
        const normalizedSnapshot = normalizedTaskSnapshot(snapshot)
        taskProgressStore.delete(taskId)
        setTaskOverrides((current) => {
          const currentVersion = current[taskId]?.updatedAt
          if (currentVersion && taskVersionIsAfter(currentVersion, snapshot.updatedAt))
            return current
          return { ...current, [taskId]: normalizedSnapshot }
        })
        if (taskIsActive(snapshot)) {
          blockedFailedTaskPollsRef.current.delete(taskId)
          const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
          failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
          setTerminalTaskPins((current) => {
            const pin = current[taskId]
            if (!pin || taskVersionIsAfter(pin.observedAt, snapshot.updatedAt)) return current
            const next = { ...current }
            delete next[taskId]
            return next
          })
          setTaskObserverGenerations((current) => ({
            ...current,
            [taskId]: (current[taskId] ?? 0) + 1,
          }))
        }
      } catch (error) {
        if (terminalReconciliationControllersRef.current.get(taskId) !== controller) return
        terminalReconciliationControllersRef.current.delete(taskId)
        if (
          retryAttempt >= 4 ||
          !taskSnapshotErrorIsTransient(error) ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration ||
          terminalReconciliationTimeoutsRef.current.has(taskId)
        )
          return
        const timeout = window.setTimeout(
          () => {
            terminalReconciliationTimeoutsRef.current.delete(taskId)
            if (
              terminalReconciliationGenerationsRef.current.get(taskId) === reconciliationGeneration
            )
              void reconcileTerminalTaskRequest(
                taskId,
                terminalVersion,
                reconciliationGeneration,
                retryAttempt + 1,
              )
          },
          Math.min(1000 * 2 ** retryAttempt, 30000),
        )
        terminalReconciliationTimeoutsRef.current.set(taskId, timeout)
      }
    },
    [knowledgeSpaceId, taskProgressStore],
  )

  useEffect(
    () => () => {
      for (const controller of terminalReconciliationControllersRef.current.values())
        controller.abort()
      terminalReconciliationControllersRef.current.clear()
      for (const timeout of terminalReconciliationTimeoutsRef.current.values())
        window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.clear()
    },
    [knowledgeSpaceId],
  )

  useEffect(() => {
    const strictRetries = new Map<string, DocumentProcessingTask>()
    const equalTimestampRetries = new Map<string, TerminalTaskPin>()
    for (const task of baseTasks) {
      const pin = terminalTaskPins[task.id]
      if (!pin || !taskIsActive(task) || taskListGeneration <= pin.taskListGeneration) continue
      if (taskVersionIsAfter(task.updatedAt, pin.observedAt)) strictRetries.set(task.id, task)
      else if (!taskVersionIsAfter(pin.observedAt, task.updatedAt))
        equalTimestampRetries.set(task.id, pin)
    }

    for (const taskId of strictRetries.keys()) {
      taskProgressStore.delete(taskId)
      blockedFailedTaskPollsRef.current.delete(taskId)
      const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
      failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
      const generation = terminalReconciliationGenerationsRef.current.get(taskId) ?? 0
      terminalReconciliationGenerationsRef.current.set(taskId, generation + 1)
      terminalReconciliationControllersRef.current.get(taskId)?.abort()
      terminalReconciliationControllersRef.current.delete(taskId)
      const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
    }
    if (strictRetries.size) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A strictly newer active list snapshot proves a retry without another request.
      setTerminalTaskPins((current) => {
        const next = { ...current }
        for (const taskId of strictRetries.keys()) delete next[taskId]
        return next
      })
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Drop terminal overrides only after a strictly newer active list snapshot.
      setTaskOverrides((current) => {
        const next = { ...current }
        for (const [taskId, task] of strictRetries) {
          const overrideVersion = current[taskId]?.updatedAt
          if (!overrideVersion || !taskVersionIsAfter(overrideVersion, task.updatedAt))
            delete next[taskId]
        }
        return next
      })
    }

    for (const [taskId, pin] of equalTimestampRetries) {
      if (equalRetryListGenerationsRef.current.get(taskId) === taskListGeneration) continue
      equalRetryListGenerationsRef.current.set(taskId, taskListGeneration)
      const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
      const reconciliationGeneration =
        (terminalReconciliationGenerationsRef.current.get(taskId) ?? 0) + 1
      terminalReconciliationGenerationsRef.current.set(taskId, reconciliationGeneration)
      void reconcileTerminalTask(taskId, pin.observedAt, reconciliationGeneration)
    }
  }, [baseTasks, reconcileTerminalTask, taskListGeneration, taskProgressStore, terminalTaskPins])

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canWrite || !files.length || uploadPendingRef.current) return
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
          const excludedItems = result.items.filter((item) => 'reason' in item)
          const detailItems = excludedItems.slice(0, 3).map((item) => {
            const reasonKey = uploadExclusionReasonKey[item.reason]
            return `${item.filename} (${t(
              ($) => $[`newKnowledge.documentUploadExclusion.${reasonKey}`],
            )})`
          })
          if (excludedItems.length > detailItems.length)
            detailItems.push(
              t(($) => $['newKnowledge.documentUploadExclusion.more'], {
                count: excludedItems.length - detailItems.length,
              }),
            )
          const exclusionDetails = detailItems.join('; ')
          if (!result.accepted) {
            toast.error(
              t(($) => $['newKnowledge.documentUploadRejected'], {
                details: exclusionDetails,
              }),
            )
            return
          }
          if (result.excluded)
            toast.warning(
              t(($) => $['newKnowledge.documentUploadPartial'], {
                accepted: result.accepted,
                details: exclusionDetails,
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
    [bulkUploadDocuments, canWrite, knowledgeSpaceId, refreshDocumentsAndTasks, t, uploadDocument],
  )

  const handleReindexDocuments = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !validSelectedDocumentIds.size ||
      reindexPendingRef.current
    )
      return
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
        setSelectedDocumentIds(new Set())
        toast.error(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: missingIds.length,
            queued: 0,
          }),
        )
        refreshDocumentsAndTasks()
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
    canWrite,
    knowledgeSpaceId,
    refreshDocumentsAndTasks,
    reindexDocuments,
    selectionDisabled,
    t,
    validSelectedDocumentIds,
  ])

  const handleTaskEvent = useCallback(
    (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => {
      const eventVersion = event.event === 'progress' ? event.data.updatedAt : taskVersion
      const terminalSnapshot = !ACTIVE_TASK_STATES.has(event.data.state)
      const serverVersion = baseTaskUpdatedAtRef.current.get(taskId)
      if (terminalSnapshot && serverVersion && taskVersionIsAfter(serverVersion, eventVersion)) {
        pendingTerminalProgressRef.current.delete(taskId)
        return false
      }

      if (event.event === 'progress' && terminalSnapshot) {
        taskProgressStore.set(taskId, event.data)
        pendingTerminalProgressRef.current.set(taskId, event)
        return true
      }

      const pendingTerminalProgress =
        event.event === 'terminal' ? pendingTerminalProgressRef.current.get(taskId) : undefined
      if (event.event === 'terminal') pendingTerminalProgressRef.current.delete(taskId)

      if (event.event === 'progress') taskProgressStore.set(taskId, event.data)
      else taskProgressStore.delete(taskId)

      const currentTaskState = currentTaskStateRef.current.get(taskId)
      if (event.event === 'progress' && currentTaskState === event.data.state) return true
      currentTaskStateRef.current.set(taskId, event.data.state)

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
                  errorCode: undefined,
                  errorMessage: undefined,
                  progressPercent: event.data.progressPercent,
                  stage: event.data.stage,
                  state: event.data.state,
                  updatedAt: event.data.updatedAt,
                }
              : {
                  errorCode: event.data.errorCode,
                  errorMessage: undefined,
                  ...(pendingTerminalProgress
                    ? {
                        progressPercent: pendingTerminalProgress.data.progressPercent,
                        stage: pendingTerminalProgress.data.stage,
                      }
                    : {}),
                  state: event.data.state,
                  updatedAt: eventVersion,
                },
        }
      })
      if (event.event === 'terminal') {
        const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
        failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
        const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
        if (timeout !== undefined) window.clearTimeout(timeout)
        terminalReconciliationTimeoutsRef.current.delete(taskId)
        const reconciliationGeneration =
          (terminalReconciliationGenerationsRef.current.get(taskId) ?? 0) + 1
        terminalReconciliationGenerationsRef.current.set(taskId, reconciliationGeneration)
        setTerminalTaskPins((current) => ({
          ...current,
          [taskId]: {
            observedAt: eventVersion,
            taskListGeneration: taskListGenerationRef.current,
          },
        }))
        if (event.data.state === 'failed')
          toast.error(t(($) => $['newKnowledge.taskFailedNotification']))
        refreshDocuments()
        void reconcileTerminalTask(taskId, eventVersion, reconciliationGeneration)
      }
      return true
    },
    [reconcileTerminalTask, refreshDocuments, t, taskProgressStore],
  )

  const handleTaskUpdated = useCallback(
    (task: DocumentProcessingTask) => {
      taskProgressStore.delete(task.id)
      currentTaskStateRef.current.set(task.id, task.state)
      setTaskOverrides((current) => ({ ...current, [task.id]: normalizedTaskSnapshot(task) }))
      if (taskIsActive(task)) {
        blockedFailedTaskPollsRef.current.delete(task.id)
        const timeout = terminalReconciliationTimeoutsRef.current.get(task.id)
        if (timeout !== undefined) window.clearTimeout(timeout)
        terminalReconciliationTimeoutsRef.current.delete(task.id)
        const generation = terminalReconciliationGenerationsRef.current.get(task.id) ?? 0
        terminalReconciliationGenerationsRef.current.set(task.id, generation + 1)
        const pollGeneration = failedTaskPollGenerationsRef.current.get(task.id) ?? 0
        failedTaskPollGenerationsRef.current.set(task.id, pollGeneration + 1)
        pendingTerminalProgressRef.current.delete(task.id)
        setTerminalTaskPins((current) => {
          const next = { ...current }
          delete next[task.id]
          return next
        })
      }
    },
    [taskProgressStore],
  )

  useEffect(() => {
    if (!orderedFailedTasksRef.current.length) return
    let canceled = false
    let timeout: number | undefined
    const pollNextBatch = async () => {
      const failedTasks = orderedFailedTasksRef.current
      const pollableTasks = failedTasks.filter(
        (task) => !blockedFailedTaskPollsRef.current.has(task.id),
      )
      if (pollableTasks.length) {
        const pollCount = Math.min(MAX_TASK_EVENT_STREAMS, pollableTasks.length)
        const offset = failedTaskPollOffsetRef.current % pollableTasks.length
        const tasksToPoll = Array.from(
          { length: pollCount },
          (_, index) => pollableTasks[(offset + index) % pollableTasks.length]!,
        )
        failedTaskPollOffsetRef.current += MAX_TASK_EVENT_STREAMS
        await Promise.allSettled(
          tasksToPoll.map(async (task) => {
            const requestGeneration = (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1
            failedTaskPollGenerationsRef.current.set(task.id, requestGeneration)
            try {
              const snapshot =
                await consoleClient.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId(
                  {
                    params: {
                      documentId: task.documentId,
                      id: knowledgeSpaceId,
                      taskId: task.id,
                    },
                  },
                )
              if (
                canceled ||
                failedTaskPollGenerationsRef.current.get(task.id) !== requestGeneration
              )
                return
              handleTaskUpdated(snapshot)
            } catch (error) {
              if (
                canceled ||
                failedTaskPollGenerationsRef.current.get(task.id) !== requestGeneration
              )
                return
              if (!taskSnapshotErrorIsTransient(error))
                blockedFailedTaskPollsRef.current.add(task.id)
            }
          }),
        )
      }
      if (!canceled) timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    }
    timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    return () => {
      canceled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [failedTaskPollSignature, handleTaskUpdated, knowledgeSpaceId])

  const toggleDocument = useCallback(
    (documentId: string) => {
      if (!canWrite || selectionDisabled) return
      setSelectedDocumentIds((current) => {
        const next = new Set(current)
        if (next.has(documentId)) next.delete(documentId)
        else next.add(documentId)
        return next
      })
    },
    [canWrite, selectionDisabled],
  )

  const toggleAllFiltered = () => {
    if (!canWrite || selectionDisabled) return
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

  const loadMoreResults = () => {
    const requests: Promise<unknown>[] = []
    if (hasNextDocumentPage && !isFetchingNextDocumentPage && !isFetchNextDocumentPageError)
      requests.push(fetchNextDocumentPage())
    if (hasNextTaskPage && !isFetchingNextTaskPage && !isFetchNextTaskPageError)
      requests.push(fetchNextTaskPage())
    if (hasNextSourcePage && !isFetchingNextSourcePage && !isFetchNextSourcePageError)
      requests.push(fetchNextSourcePage())
    void Promise.allSettled(requests)
  }

  return (
    <>
      {streamedActiveTasks.map((task) => (
        <TaskEventObserver
          key={`${task.id}:${taskObserverGenerations[task.id] ?? 0}`}
          documentId={task.documentId}
          knowledgeSpaceId={knowledgeSpaceId}
          onEvent={handleTaskEvent}
          taskId={task.id}
          taskVersion={baseTaskUpdatedAt.get(task.id) ?? task.updatedAt}
        />
      ))}
      {canWrite && (
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
      <section
        aria-labelledby="new-knowledge-documents-title"
        className="flex min-h-full flex-col px-4 py-6 sm:px-8 sm:py-7"
      >
        <header>
          <h2 id="new-knowledge-documents-title" className="title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.documents'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.documentsDescription'])}
          </p>
          {!permissionPending && !permissionQueryError && !canEdit && (
            <p
              id="documents-readonly-reason"
              className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
            >
              <span aria-hidden className="i-ri-lock-line size-3.5" />
              {t(($) => $['newKnowledge.permissionRestricted'])}
            </p>
          )}
        </header>
        {permissionQueryError && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
            role="alert"
          >
            <span className="system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.permissionLoadFailed'])}
            </span>
            <Button size="small" onClick={retryWorkspacePermissionKeys}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}
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
        ) : dependencyQueryBlockingError ? (
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
        ) : !documents.length ? (
          <DocumentsEmpty
            canEdit={canWrite}
            onAddDocument={() => uploadInputRef.current?.click()}
            onDropFiles={(files) => void handleUploadFiles(files)}
            readOnlyReasonId={
              !permissionPending && !permissionQueryError && !canEdit
                ? 'documents-readonly-reason'
                : undefined
            }
            uploading={uploading}
          />
        ) : (
          <>
            {dependencyQueryWarning && (
              <div
                className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
                role="alert"
              >
                <span className="system-xs-regular text-text-tertiary">
                  {sourcesQuery.error || sourcesQuery.isFetchNextPageError
                    ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                    : t(($) => $['newKnowledge.tasksErrorDescription'])}
                </span>
                <Button size="small" onClick={retryDependencyQueries}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            )}
            <DocumentsList
              activeTaskCount={activeTasks.length}
              allSelected={allFilteredSelected}
              attentionTaskCount={attentionTasks.length}
              canEdit={canWrite}
              completingResults={completingFilteredResults}
              documents={filteredDocuments}
              filter={filter}
              hasNextPage={Boolean(hasNextDocumentPage || hasNextTaskPage || hasNextSourcePage)}
              hasSelectableDocuments={Boolean(selectableFilteredDocuments.length)}
              hasTaskError={hasTaskError}
              isFetchNextPageError={documentsQuery.isFetchNextPageError}
              isFetchingNextPage={documentsQuery.isFetchingNextPage}
              onAddDocument={() => uploadInputRef.current?.click()}
              onFilterChange={setFilter}
              onLoadMore={loadMoreResults}
              onOpenTasks={() => setTasksOpen(true)}
              onSearchChange={setSearch}
              onSelectAll={toggleAllFiltered}
              onSelectDocument={toggleDocument}
              readOnlyReasonId={
                !permissionPending && !permissionQueryError && !canEdit
                  ? 'documents-readonly-reason'
                  : undefined
              }
              search={search}
              selectionDisabled={selectionDisabled}
              selectedDocumentIds={validSelectedDocumentIds}
              someSelected={someFilteredSelected}
              sourcesPending={sourceResultsIncomplete}
              sourceNames={sourceNames}
              statusPending={dependencyResultsIncomplete}
              statuses={documentStatuses}
              tasksButtonLabel={tasksButtonLabel}
              tasksLiveStatus={tasksLiveStatus}
              uploading={uploading}
            />
          </>
        )}
      </section>
      {canWrite && !!validSelectedDocumentIds.size && (
        <DocumentBulkActions
          disabled={selectionDisabled}
          onClear={() => setSelectedDocumentIds(new Set())}
          onReindex={() => void handleReindexDocuments()}
          reindexing={reindexing}
          selectedCount={validSelectedDocumentIds.size}
        />
      )}
      <ProcessingTasksDrawer
        canEdit={canWrite && !taskResultsIncomplete && !tasksQuery.error}
        documents={documents}
        knowledgeSpaceId={knowledgeSpaceId}
        onOpenChange={setTasksOpen}
        onRetryTaskQuery={() => void tasksQuery.refetch()}
        onTaskUpdated={handleTaskUpdated}
        open={tasksOpen}
        taskQueryPending={tasksQuery.isPending}
        taskQueryError={Boolean(tasksQuery.error)}
        taskProgressStore={taskProgressStore}
        tasks={tasks}
      />
    </>
  )
}
