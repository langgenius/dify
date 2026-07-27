'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { consoleQuery } from '@/service/client'
import { newestTaskByDocument } from './document-model'
import { documentTaskListFromApi } from './document-models'

const TASK_PAGE_SIZE = 100
const TASK_LOOKUP_PAGE_BATCH = 3
const ACTIVE_TASK_REFRESH_INTERVAL = 5000
const SUBMISSION_DISCOVERY_REFRESH_INTERVAL = 2000

function documentTaskIsActive(state: string | undefined) {
  return (
    state === 'dispatch_pending' ||
    state === 'queued' ||
    state === 'running' ||
    state === 'retry_wait'
  )
}

export function useDocumentTaskStatus({
  documentId,
  enabled,
  knowledgeSpaceId,
  minimumRevision,
  submissionNeedsRecheck,
  submissionPending,
}: {
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
    isFetchingNextPage,
    isPending,
    refetch,
  } = tasksQuery
  const tasks = useMemo(
    () => tasksData?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? [],
    [tasksData],
  )
  const latestTask = useMemo(() => {
    const task = newestTaskByDocument(
      tasks.filter(
        (candidate) =>
          candidate.documentId === documentId && candidate.documentRevision >= minimumRevision,
      ),
    ).get(documentId)
    return task && task.documentRevision >= minimumRevision ? task : undefined
  }, [documentId, minimumRevision, tasks])
  const lookupExhausted = Boolean(
    !latestTask && hasNextPage && (tasksData?.pages.length ?? 0) >= lookupPageLimit,
  )

  useEffect(() => {
    if (
      isPending ||
      !enabled ||
      isFetchingNextPage ||
      tasksError ||
      latestTask ||
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
    latestTask,
    lookupExhausted,
    tasksError,
  ])

  return {
    continueLookup: () => setLookupPageLimit((current) => current + TASK_LOOKUP_PAGE_BATCH),
    isFetchingNextPage,
    isLookingUp: Boolean(!latestTask && hasNextPage && !lookupExhausted),
    isPending,
    latestTask,
    lookupExhausted,
    queryKey: tasksQueryOptions.queryKey,
    refetch,
    taskIsActive: documentTaskIsActive(latestTask?.state),
    tasksError,
  }
}
