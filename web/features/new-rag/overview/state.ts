import type { KnowledgeFsBackgroundTaskResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { atomWithLazy, selectAtom } from 'jotai/utils'
import { parseAsStringLiteral } from 'nuqs'
import { createQueryAtoms } from 'nuqs-jotai'
import { consoleQuery } from '@/service/client'
import { OVERVIEW_REFRESH_INTERVAL, overviewRefreshInterval } from './overview-format'

export const OVERVIEW_WINDOWS = ['24h', '7d', '30d'] as const
export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number]

const ACTIVE_TASK_STATES = new Set<KnowledgeFsBackgroundTaskResponse['state']>([
  'queued',
  'running',
])
const TASK_PAGE_SIZE = 20
const ACTIVITY_PREVIEW_PAGE_SIZE = 20

export const overviewKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing overview knowledge space id')
})
export const overviewLocationQuery = createQueryAtoms(
  {
    window: parseAsStringLiteral(OVERVIEW_WINDOWS)
      .withDefault('24h')
      .withOptions({ history: 'push' }),
  },
  { debugLabel: 'overview.location' },
)
export const { window: overviewWindowAtom } = overviewLocationQuery.atoms

function isFirstSourceTask(task: KnowledgeFsBackgroundTaskResponse) {
  return (
    task.operation === 'document_processing' ||
    task.operation === 'document_upload' ||
    task.operation.includes('import')
  )
}

const backgroundTasksQueryAtom = atomWithInfiniteQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
    input: (pageParam) => ({
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
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
  }),
)

const backgroundTasksQueryDataAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.data)
const backgroundTasksRefetchAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.refetch)
const backgroundTasksPendingAtom = selectAtom(backgroundTasksQueryAtom, (query) => query.isPending)

const backgroundTasksAtom = atom(
  (get) => get(backgroundTasksQueryDataAtom)?.pages.flatMap((page) => page.data) ?? [],
)
const overviewHasActiveTasksAtom = atom((get) =>
  get(backgroundTasksAtom).some((task) => ACTIVE_TASK_STATES.has(task.state)),
)
const latestTaskUpdatedAtAtom = atom((get) =>
  get(backgroundTasksAtom).reduce<number | undefined>((latest, task) => {
    const updatedAt = Date.parse(task.updated_at)
    if (!Number.isFinite(updatedAt)) return latest
    return latest === undefined || updatedAt > latest ? updatedAt : latest
  }, undefined),
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

const statsQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.stats.get.queryOptions({
    input: {
      params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) },
      query: { window: get(overviewWindowAtom) },
    },
    refetchInterval: (query) =>
      overviewRefreshInterval({
        generatedAt: query.state.data?.generated_at,
        hasActiveTasks: get(overviewHasActiveTasksAtom),
        latestTaskUpdatedAt: get(latestTaskUpdatedAtAtom),
      }),
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
    refetchInterval: (query) =>
      overviewRefreshInterval({
        generatedAt: query.state.data?.generated_at,
        hasActiveTasks: get(overviewHasActiveTasksAtom),
        latestTaskUpdatedAt: get(latestTaskUpdatedAtAtom),
      }),
  }),
)
export const overviewOutcomesDataAtom = selectAtom(outcomesQueryAtom, (query) => query.data)
export const overviewOutcomesPendingAtom = selectAtom(outcomesQueryAtom, (query) => query.isPending)
export const overviewOutcomesErrorAtom = selectAtom(outcomesQueryAtom, (query) => query.isError)
const outcomesRefetchAtom = selectAtom(outcomesQueryAtom, (query) => query.refetch)

const inventoryQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.inventory.get.queryOptions({
    input: { params: { control_space_id: get(overviewKnowledgeSpaceIdAtom) } },
    refetchInterval: (query) =>
      overviewRefreshInterval({
        generatedAt: query.state.data?.generated_at,
        hasActiveTasks: get(overviewHasActiveTasksAtom),
        latestTaskUpdatedAt: get(latestTaskUpdatedAtAtom),
      }),
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
    refetchInterval: get(overviewHasActiveTasksAtom) ? OVERVIEW_REFRESH_INTERVAL : false,
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
      query: { limit: ACTIVITY_PREVIEW_PAGE_SIZE },
    },
    refetchInterval: get(overviewHasActiveTasksAtom) ? OVERVIEW_REFRESH_INTERVAL : false,
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
export const refreshOverviewBackgroundTasksAtom = atom(null, (get) =>
  get(backgroundTasksRefetchAtom)(),
)
export const retryOverviewActivityPreviewAtom = atom(null, (get) => {
  void get(activityPreviewRefetchAtom)()
})
