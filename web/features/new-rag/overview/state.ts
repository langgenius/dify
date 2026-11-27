import type { KnowledgeFsBackgroundTaskResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery, queryClientAtom } from 'jotai-tanstack-query'
import { atomWithLazy, selectAtom } from 'jotai/utils'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { activityDatesForRange } from './overview-activity-types'
import { OVERVIEW_REFRESH_INTERVAL, overviewRefreshInterval } from './overview-format'
import { overviewQueryGroup } from './query-state'

const ACTIVE_TASK_STATES = new Set<KnowledgeFsBackgroundTaskResponse['state']>([
  'queued',
  'running',
])
const TASK_PAGE_SIZE = 20
const ACTIVITY_PREVIEW_PAGE_SIZE = 20

export const overviewKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing overview knowledge space id')
})
export const overviewWindowAtom = overviewQueryGroup.fields.window

function isFirstSourceTask(task: KnowledgeFsBackgroundTaskResponse) {
  return (
    task.operation === 'document_processing' ||
    task.operation === 'document_upload' ||
    task.operation.includes('import')
  )
}

export function overviewBackgroundTasksOptions(knowledgeSpaceId: string) {
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
    input: (pageParam) => ({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        limit: TASK_PAGE_SIZE,
      },
    }),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.data.some((task) => ACTIVE_TASK_STATES.has(task.state)),
      )
        ? OVERVIEW_REFRESH_INTERVAL
        : false,
  })
}

const backgroundTasksQueryAtom = atomWithInfiniteQuery((get) =>
  overviewBackgroundTasksOptions(get(overviewKnowledgeSpaceIdAtom)),
)

export type OverviewTaskPolling = {
  hasActiveTasks: boolean
  latestTaskUpdatedAt?: number
}

// A stable completion token, not a copy of task state. It changes when a terminal task is
// observed (including retry completion) but not on each in-flight progress poll.
export function overviewTerminalTasksVersion(tasks: KnowledgeFsBackgroundTaskResponse[]) {
  return tasks
    .filter((task) => !ACTIVE_TASK_STATES.has(task.state))
    .map((task) => `${task.task_kind}:${task.id}:${task.state}:${task.updated_at}`)
    .sort()
    .join('|')
}

export function overviewTaskPollingState(
  tasks: KnowledgeFsBackgroundTaskResponse[],
): OverviewTaskPolling {
  return {
    hasActiveTasks: tasks.some((task) => ACTIVE_TASK_STATES.has(task.state)),
    latestTaskUpdatedAt: tasks.reduce<number | undefined>((latest, task) => {
      const updatedAt = Date.parse(task.updated_at)
      if (!Number.isFinite(updatedAt)) return latest
      return latest === undefined || updatedAt > latest ? updatedAt : latest
    }, undefined),
  }
}

// Snapshot polling reads the task list from the Query cache when the interval is evaluated.
// Reading it through the scoped task atoms can return a copy that stopped receiving updates, so
// polling would never notice that the tasks finished.
function cachedTaskPolling(
  queryClient: QueryClient,
  knowledgeSpaceId: string,
): OverviewTaskPolling | undefined {
  const state = queryClient.getQueryState(overviewBackgroundTasksOptions(knowledgeSpaceId).queryKey)
  if (state?.data) return overviewTaskPollingState(state.data.pages.flatMap((page) => page.data))
  // A failed task request does not poll again, so it must not keep the snapshots polling either.
  if (state?.status === 'error') return { hasActiveTasks: false }
  return undefined
}

const backgroundTasksQueryDataAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.data)
const backgroundTasksRefetchAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.refetch)
const backgroundTasksPendingAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.isPending)

const backgroundTasksAtom = atom(
  (get) => get(backgroundTasksQueryDataAtom)?.pages.flatMap((page) => page.data) ?? [],
)
export const overviewIndexingTaskAtom = atom((get) =>
  get(backgroundTasksAtom).find(
    (task) => ACTIVE_TASK_STATES.has(task.state) && isFirstSourceTask(task),
  ),
)
export const overviewFailedFirstSourceTaskAtom = atom((get) => {
  const latestTask = get(backgroundTasksAtom)
    .filter(isFirstSourceTask)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0]
  return latestTask?.state === 'failed' ? latestTask : undefined
})

function snapshotRefreshInterval(get: Getter) {
  const queryClient = get(queryClientAtom)
  const knowledgeSpaceId = get(overviewKnowledgeSpaceIdAtom)
  return (query: { state: { data?: { generated_at?: string } } }) => {
    const tasks = cachedTaskPolling(queryClient, knowledgeSpaceId)
    // Keep polling until the task list is known; the next fetch re-evaluates with it.
    if (!tasks) return OVERVIEW_REFRESH_INTERVAL
    return overviewRefreshInterval({ generatedAt: query.state.data?.generated_at, ...tasks })
  }
}

function activeTaskRefreshInterval(get: Getter) {
  const queryClient = get(queryClientAtom)
  const knowledgeSpaceId = get(overviewKnowledgeSpaceIdAtom)
  return () =>
    (cachedTaskPolling(queryClient, knowledgeSpaceId)?.hasActiveTasks ?? true)
      ? OVERVIEW_REFRESH_INTERVAL
      : false
}

const statsQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.stats.get.queryOptions({
    input: {
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
      query: { window: get(overviewWindowAtom) },
    },
    refetchInterval: snapshotRefreshInterval(get),
  }),
)
export const overviewStatsDataAtom = selectAtom(statsQueryAtom, (query) => query.data)
export const overviewStatsPendingAtom = selectAtom(statsQueryAtom, (query) => query.isPending)
const statsErrorAtom = selectAtom(statsQueryAtom, (query) => query.isError)
const statsRefetchAtom = selectAtom(statsQueryAtom, (query) => query.refetch)

const outcomesQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.queryOutcomes.get.queryOptions({
    input: {
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
      query: { window: get(overviewWindowAtom) },
    },
    refetchInterval: snapshotRefreshInterval(get),
  }),
)
export const overviewOutcomesDataAtom = selectAtom(outcomesQueryAtom, (query) => query.data)
export const overviewOutcomesPendingAtom = selectAtom(outcomesQueryAtom, (query) => query.isPending)
export const overviewOutcomesErrorAtom = selectAtom(outcomesQueryAtom, (query) => query.isError)
const outcomesRefetchAtom = selectAtom(outcomesQueryAtom, (query) => query.refetch)

const inventoryQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.inventory.get.queryOptions({
    input: { params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) } },
    refetchInterval: snapshotRefreshInterval(get),
  }),
)
export const overviewInventoryDataAtom = selectAtom(inventoryQueryAtom, (query) => query.data)
export const overviewInventoryPendingAtom = selectAtom(
  inventoryQueryAtom,
  (query) => query.isPending,
)
export const overviewInventoryErrorAtom = selectAtom(inventoryQueryAtom, (query) => query.isError)
const inventoryRefetchAtom = selectAtom(inventoryQueryAtom, (query) => query.refetch)

const attentionQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.attention.get.queryOptions({
    input: {
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
      query: { include_dismissed: false, limit: 100 },
    },
    refetchInterval: activeTaskRefreshInterval(get),
  }),
)
export const overviewAttentionDataAtom = selectAtom(
  attentionQueryAtom,
  (query) => query.data?.data ?? [],
)
export const overviewAttentionPendingAtom = selectAtom(
  attentionQueryAtom,
  (query) => query.isPending,
)
export const overviewAttentionErrorAtom = selectAtom(attentionQueryAtom, (query) => query.isError)
const attentionRefetchAtom = selectAtom(attentionQueryAtom, (query) => query.refetch)

const indexingSourceQueryAtom = atomWithQuery((get) => {
  const indexingTask = get(overviewIndexingTaskAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get.queryOptions({
    input: indexingTask?.source_id
      ? {
          params: {
            control_space_id: get(overviewKnowledgeSpaceIdAtom),
            source_id: indexingTask.source_id,
          },
        }
      : skipToken,
  })
})
export const overviewIndexingSourceNameAtom = atom((get) => get(indexingSourceQueryAtom).data?.name)
const indexingSourcePendingAtom = selectAtom(indexingSourceQueryAtom, (query) => query.isPending)

const activityPreviewQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.queryOptions({
    input: {
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
      query: {
        limit: ACTIVITY_PREVIEW_PAGE_SIZE,
        ...(get(deploymentEditionAtom) === 'CLOUD'
          ? { from_at: activityDatesForRange('90d').start.toISOString() }
          : {}),
      },
    },
    refetchInterval: activeTaskRefreshInterval(get),
  }),
)
export const overviewActivityPreviewDataAtom = selectAtom(
  activityPreviewQueryAtom,
  (query) => query.data?.data ?? [],
)
export const overviewActivityPreviewPendingAtom = selectAtom(
  activityPreviewQueryAtom,
  (query) => query.isPending,
)
export const overviewActivityPreviewErrorAtom = selectAtom(
  activityPreviewQueryAtom,
  (query) => query.isError,
)
export const overviewActivityPreviewRefetchingAtom = selectAtom(
  activityPreviewQueryAtom,
  (query) => query.isRefetching,
)
const activityPreviewRefetchAtom = selectAtom(activityPreviewQueryAtom, (query) => query.refetch)

export const overviewPageLoadingAtom = atom((get) => {
  const indexingTask = get(overviewIndexingTaskAtom)
  return (
    get(backgroundTasksPendingAtom) ||
    get(overviewStatsPendingAtom) ||
    get(overviewOutcomesPendingAtom) ||
    get(overviewInventoryPendingAtom) ||
    get(overviewAttentionPendingAtom) ||
    (indexingTask?.source_id != null && get(indexingSourcePendingAtom))
  )
})
export const overviewFirstLoadFailedAtom = atom(
  (get) =>
    !get(overviewPageLoadingAtom) &&
    (get(statsErrorAtom) ||
      get(overviewOutcomesErrorAtom) ||
      get(overviewInventoryErrorAtom) ||
      get(overviewAttentionErrorAtom)),
)
const overviewHasContentAtom = atom((get) => {
  const stats = get(overviewStatsDataAtom)
  return (stats?.source_count ?? 0) > 0 || (stats?.documents ?? 0) > 0
})
export const overviewShowIndexingAtom = atom(
  (get) =>
    !get(overviewPageLoadingAtom) &&
    !get(overviewInventoryErrorAtom) &&
    (get(overviewInventoryDataAtom)?.index_coverage.indexed ?? 0) === 0 &&
    get(overviewIndexingTaskAtom) !== undefined,
)
export const overviewEmptyAtom = atom(
  (get) =>
    !get(overviewPageLoadingAtom) &&
    !get(statsErrorAtom) &&
    !get(overviewHasContentAtom) &&
    !get(overviewShowIndexingAtom),
)
export const overviewShowEmptyModulesAtom = atom(
  (get) => get(overviewEmptyAtom) || get(overviewShowIndexingAtom),
)

export const retryOverviewSnapshotsAtom = atom(null, (get) => {
  void Promise.all([
    get(statsRefetchAtom)(),
    get(outcomesRefetchAtom)(),
    get(inventoryRefetchAtom)(),
    get(attentionRefetchAtom)(),
    get(backgroundTasksRefetchAtom)(),
  ])
})
export const reconcileOverviewAfterTasksAtom = atom(
  null,
  async (get, _set, { refreshSnapshots }: { refreshSnapshots: boolean }) => {
    const queryClient = get(queryClientAtom)
    const input = { params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) } }
    const overview = consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview
    // Stopped snapshots do not re-evaluate their interval, so a newly observed terminal task must
    // refresh them; their interval then keeps polling until they catch up with that task.
    if (refreshSnapshots) {
      for (const queryKey of [
        overview.stats.get.key({ input }),
        overview.queryOutcomes.get.key({ input }),
        overview.inventory.get.key({ input }),
      ])
        void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })
    }
    const keys = [overview.attention.get.key({ input }), overview.activity.get.key({ input })]
    if (get(deploymentEditionAtom) === 'CLOUD') {
      void Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: consoleQuery.features.get.key() },
          { cancelRefetch: false },
        ),
        queryClient.invalidateQueries(
          { queryKey: consoleQuery.features.vectorSpace.get.key() },
          { cancelRefetch: false },
        ),
      ])
    }
    await Promise.all(
      keys.map(async (queryKey) => {
        // A pre-completion request may finish late with a stale snapshot. Cancel it before the
        // final fetch; dataUpdatedAt alone cannot tell when its server-side snapshot was taken.
        await queryClient.cancelQueries({ queryKey })
        await queryClient.invalidateQueries({ queryKey })
      }),
    )
  },
)
// Snapshot intervals are evaluated after each of their own fetches, so a snapshot that stopped
// polling does not notice a task that starts later. Refresh the snapshots once when that happens;
// their intervals then read the active task from the cache and resume polling.
export const resumeOverviewPollingAtom = atom(null, async (get) => {
  const queryClient = get(queryClientAtom)
  const input = { params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) } }
  const overview = consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview
  await Promise.all(
    [
      overview.stats.get.key({ input }),
      overview.queryOutcomes.get.key({ input }),
      overview.inventory.get.key({ input }),
      overview.attention.get.key({ input }),
      overview.activity.get.key({ input }),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })),
  )
})
export const retryOverviewActivityPreviewAtom = atom(null, (get) => {
  void get(activityPreviewRefetchAtom)()
})
