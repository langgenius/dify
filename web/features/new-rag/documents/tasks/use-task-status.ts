'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { consoleQuery } from '@/service/client'
import { newestTaskByDocument } from '../model'
import { backgroundTaskListFromApi, documentTaskListFromApi } from '../models'

const TASK_PAGE_SIZE = 100
const TASK_LOOKUP_PAGE_BATCH = 3
const ACTIVE_TASK_REFRESH_INTERVAL = 5000
const SUBMISSION_DISCOVERY_REFRESH_INTERVAL = 2000

export function documentTaskIsActive(state: string | undefined) {
  return (
    state === 'dispatch_pending' ||
    state === 'queued' ||
    state === 'running' ||
    state === 'retry_wait'
  )
}

export function useDocumentTaskStatus({
  acceptedTaskId,
  documentId,
  enabled,
  knowledgeSpaceId,
  minimumRevision,
  submissionNeedsRecheck,
  submissionPending,
}: {
  acceptedTaskId?: string
  documentId: string
  enabled: boolean
  knowledgeSpaceId: string
  minimumRevision: number
  submissionNeedsRecheck: boolean
  submissionPending: boolean
}) {
  const [lookupPageLimit, setLookupPageLimit] = useState(TASK_LOOKUP_PAGE_BATCH)
  const tasksQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
        enabled,
        input: (pageParam) => ({
          params: { control_space_id: knowledgeSpaceId },
          query: {
            limit: TASK_PAGE_SIZE,
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          },
        }),
        getNextPageParam: (lastPage) => lastPage.next_cursor,
        initialPageParam: null as string | null,
        refetchInterval: (query) => {
          const tasks =
            query.state.data?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? []
          if (
            tasks.some((task) => task.documentId === documentId && documentTaskIsActive(task.state))
          )
            return ACTIVE_TASK_REFRESH_INTERVAL
          return submissionPending || submissionNeedsRecheck
            ? SUBMISSION_DISCOVERY_REFRESH_INTERVAL
            : false
        },
      }),
    [documentId, enabled, knowledgeSpaceId, submissionNeedsRecheck, submissionPending],
  )
  const tasksQuery = useInfiniteQuery(tasksQueryOptions)
  const {
    data: tasksData,
    error: tasksError,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchNextPageError,
    isFetchingNextPage,
    isPending,
    refetch,
  } = tasksQuery
  const tasks = useMemo(
    () => tasksData?.pages.flatMap((page) => backgroundTaskListFromApi(page).items) ?? [],
    [tasksData],
  )
  const documentTasks = useMemo(
    () => tasksData?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? [],
    [tasksData],
  )
  const acceptedTask = useMemo(
    () =>
      acceptedTaskId
        ? documentTasks.find((candidate) => candidate.id === acceptedTaskId)
        : undefined,
    [acceptedTaskId, documentTasks],
  )
  const latestTask = useMemo(() => {
    if (acceptedTask) return acceptedTask
    const task = newestTaskByDocument(
      documentTasks.filter(
        (candidate) =>
          candidate.documentId === documentId && candidate.documentRevision >= minimumRevision,
      ),
    ).get(documentId)
    return task && task.documentRevision >= minimumRevision ? task : undefined
  }, [acceptedTask, documentId, documentTasks, minimumRevision])
  const lookupSatisfied = acceptedTaskId ? Boolean(acceptedTask) : Boolean(latestTask)
  const lookupExhausted = Boolean(
    !lookupSatisfied && hasNextPage && (tasksData?.pages.length ?? 0) >= lookupPageLimit,
  )
  useEffect(() => {
    if (
      isPending ||
      !enabled ||
      isFetchingNextPage ||
      tasksError ||
      lookupSatisfied ||
      !hasNextPage ||
      lookupExhausted
    )
      return
    void fetchNextPage()
  }, [
    enabled,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    lookupSatisfied,
    lookupExhausted,
    tasksError,
  ])

  return {
    continueLookup: () => setLookupPageLimit((current) => current + TASK_LOOKUP_PAGE_BATCH),
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetching,
    isFetchingNextPage,
    isLookingUp: Boolean(!lookupSatisfied && hasNextPage && !lookupExhausted),
    isPending,
    latestTask,
    lookupExhausted,
    queryKey: tasksQueryOptions.queryKey,
    refetch,
    taskIsActive: documentTaskIsActive(latestTask?.state),
    tasks,
    tasksError,
  }
}
