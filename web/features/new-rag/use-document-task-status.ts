'use client'

import type {
  DocumentProcessingTask,
  DocumentProcessingTaskList,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { consoleQuery } from '@/service/client'
import { responseStatus } from './document-detail-model'
import { newestTaskByDocument } from './document-model'

const TASK_PAGE_SIZE = 100
const TASK_LOOKUP_PAGE_BATCH = 3
const ACTIVE_TASK_REFRESH_INTERVAL = 5000
const SUBMISSION_DISCOVERY_REFRESH_INTERVAL = 2000

function documentTaskIsActive(task: DocumentProcessingTask | undefined) {
  return (
    task?.state === 'dispatch_pending' ||
    task?.state === 'queued' ||
    task?.state === 'running' ||
    task?.state === 'retry_wait'
  )
}

export function useDocumentTaskStatus({
  documentId,
  enabled,
  knowledgeSpaceId,
  minimumRevision,
  submissionDiscoveryGeneration,
  submissionNeedsRecheck,
  submissionPending,
}: {
  documentId: string
  enabled: boolean
  knowledgeSpaceId: string
  minimumRevision: number
  submissionDiscoveryGeneration?: number
  submissionNeedsRecheck: boolean
  submissionPending: boolean
}) {
  const queryClient = useQueryClient()
  const completedDiscoveryGenerationRef = useRef<number | undefined>(undefined)
  const missingTaskIdsRef = useRef(new Set<string>())
  const [lookupPageLimit, setLookupPageLimit] = useState(TASK_LOOKUP_PAGE_BATCH)
  const tasksQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.getKnowledgeSpacesByIdProcessingTasks.infiniteOptions({
        enabled,
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
    [enabled, knowledgeSpaceId],
  )
  const tasksQuery = useInfiniteQuery(tasksQueryOptions)
  const {
    data: tasksData,
    error: tasksQueryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch: refetchTasks,
  } = tasksQuery
  const historyTasks = useMemo(
    () => tasksData?.pages.flatMap((page) => page.items) ?? [],
    [tasksData],
  )
  const historyHasSubmittedTask = historyTasks.some(
    (task) =>
      !missingTaskIdsRef.current.has(task.id) &&
      task.documentId === documentId &&
      task.documentRevision >= minimumRevision,
  )
  const submissionTasksQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.getKnowledgeSpacesByIdProcessingTasks.queryOptions({
        enabled: enabled && submissionPending && !historyHasSubmittedTask,
        input: {
          params: { id: knowledgeSpaceId },
          query: { limit: TASK_PAGE_SIZE },
        },
        refetchInterval: (query) => {
          if (
            query.state.error ||
            !submissionDiscoveryGeneration ||
            completedDiscoveryGenerationRef.current === submissionDiscoveryGeneration
          )
            return false
          const hasSubmittedTask = query.state.data?.items.some(
            (task) =>
              !missingTaskIdsRef.current.has(task.id) &&
              task.documentId === documentId &&
              task.documentRevision >= minimumRevision,
          )
          if (hasSubmittedTask) {
            completedDiscoveryGenerationRef.current = submissionDiscoveryGeneration
            return false
          }
          return enabled && submissionPending && !hasSubmittedTask
            ? SUBMISSION_DISCOVERY_REFRESH_INTERVAL
            : false
        },
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = responseStatus(error)
          return status !== 403 && status !== 404 && failureCount < 2
        },
      }),
    [
      documentId,
      enabled,
      historyHasSubmittedTask,
      knowledgeSpaceId,
      minimumRevision,
      submissionDiscoveryGeneration,
      submissionPending,
    ],
  )
  const submissionTasksQuery = useQuery(submissionTasksQueryOptions)
  const tasks = useMemo(
    () => [...(submissionTasksQuery.data?.items ?? []), ...historyTasks],
    [historyTasks, submissionTasksQuery.data],
  )
  const discoveredTask = useMemo(() => {
    const candidate = newestTaskByDocument(
      tasks.filter(
        (task) =>
          !missingTaskIdsRef.current.has(task.id) &&
          task.documentId === documentId &&
          task.documentRevision >= minimumRevision,
      ),
    ).get(documentId)
    return candidate && candidate.documentRevision >= minimumRevision ? candidate : undefined
  }, [documentId, minimumRevision, tasks])
  const discoveredTaskIsActive = documentTaskIsActive(discoveredTask)
  const taskSnapshotQuery = useQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId.queryOptions(
      {
        enabled: enabled && discoveredTaskIsActive,
        input:
          enabled && discoveredTaskIsActive && discoveredTask
            ? {
                params: {
                  documentId,
                  id: knowledgeSpaceId,
                  taskId: discoveredTask.id,
                },
              }
            : skipToken,
        refetchInterval: (query) =>
          !query.state.error && documentTaskIsActive(query.state.data ?? discoveredTask)
            ? ACTIVE_TASK_REFRESH_INTERVAL
            : false,
        retry: (failureCount, error) => {
          const status = responseStatus(error)
          return status !== 403 && status !== 404 && failureCount < 2
        },
      },
    ),
  )
  const taskSnapshotErrorStatus = responseStatus(taskSnapshotQuery.error)
  const latestTask =
    taskSnapshotErrorStatus === 403 || taskSnapshotErrorStatus === 404
      ? undefined
      : taskSnapshotQuery.data?.id === discoveredTask?.id
        ? taskSnapshotQuery.data
        : discoveredTask
  const lookupExhausted = Boolean(
    !latestTask && hasNextPage && (tasksData?.pages.length ?? 0) >= lookupPageLimit,
  )

  useEffect(() => {
    if (
      isPending ||
      !enabled ||
      isFetchingNextPage ||
      tasksQueryError ||
      latestTask ||
      !hasNextPage ||
      lookupExhausted
    )
      return
    void fetchNextPage()
  }, [
    fetchNextPage,
    enabled,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    latestTask,
    lookupExhausted,
    tasksQueryError,
  ])

  useEffect(() => {
    if (
      taskSnapshotErrorStatus !== 404 ||
      !discoveredTask ||
      missingTaskIdsRef.current.has(discoveredTask.id)
    )
      return
    missingTaskIdsRef.current.add(discoveredTask.id)
    if (completedDiscoveryGenerationRef.current === submissionDiscoveryGeneration)
      completedDiscoveryGenerationRef.current = undefined
    queryClient.setQueryData<DocumentProcessingTaskList>(
      submissionTasksQueryOptions.queryKey,
      (current) =>
        current
          ? { ...current, items: current.items.filter((task) => task.id !== discoveredTask.id) }
          : current,
    )
    queryClient.setQueryData<InfiniteData<DocumentProcessingTaskList, string | null>>(
      tasksQueryOptions.queryKey,
      (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.filter((task) => task.id !== discoveredTask.id),
              })),
            }
          : current,
    )
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: submissionTasksQueryOptions.queryKey }),
    ])
  }, [
    discoveredTask,
    queryClient,
    submissionDiscoveryGeneration,
    submissionTasksQueryOptions.queryKey,
    taskSnapshotErrorStatus,
    tasksQueryOptions.queryKey,
  ])

  return {
    continueLookup: () => setLookupPageLimit((current) => current + TASK_LOOKUP_PAGE_BATCH),
    isFetchingNextPage,
    isLookingUp: Boolean(!latestTask && hasNextPage && !lookupExhausted),
    isPending,
    latestTask,
    lookupExhausted,
    queryKey: tasksQueryOptions.queryKey,
    refetch: async () => {
      const results = await Promise.all([
        refetchTasks(),
        ...(enabled && submissionNeedsRecheck ? [submissionTasksQuery.refetch()] : []),
        ...(enabled && discoveredTaskIsActive ? [taskSnapshotQuery.refetch()] : []),
      ])
      return results[0]
    },
    taskIsActive: documentTaskIsActive(latestTask),
    tasksError:
      tasksQueryError ??
      (submissionPending && !historyHasSubmittedTask ? submissionTasksQuery.error : undefined) ??
      (taskSnapshotErrorStatus === 404 ? undefined : taskSnapshotQuery.error),
  }
}
