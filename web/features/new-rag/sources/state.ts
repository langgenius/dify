import type { SourceFilter } from './source-list-query-state'
import type { Source } from './source-models'
import { atom } from 'jotai'
import { atomWithInfiniteQuery } from 'jotai-tanstack-query'
import { atomWithLazy, selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import {
  initialSourcePollingPhase,
  shouldHidePreviewSource,
  sourceDisplayStatus,
  sourceFromApi,
  sourceNeedsPolling,
  sourceStatusWithSyncWorkflow,
  sourceWorkflowIsActive,
} from './source-models'

export type SourceSort = 'name-asc' | 'name-desc' | null

const PAGE_SIZE = 200
export const MAX_AUTO_CURSOR_PAGES = 5
const AWAIT_INITIAL_SOURCE_POLL_INTERVAL = 2000
const SOURCE_POLL_INTERVAL = 3000

export const sourcesKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing Sources knowledge space id')
})
export const sourcesFilterAtom = atom<SourceFilter>('all')
export const sourcesSearchAtom = atom('')
export const sourcesSortAtom = atom<SourceSort>(null)
export const sourcesAwaitedOperationIdAtom = atom<string | null>(null)

export const sourceOverridesAtom = atom<Record<string, Source>>({})
export const removedSourceIdsAtom = atom<Set<string>>(new Set<string>())
export const sourcePollingTimeoutAtom = atom<{
  awaitedOperationId: string | null
  timedOut: boolean
}>({ awaitedOperationId: null, timedOut: false })

function latestSourceWorkflow(
  sourceWorkflow?: Source['syncWorkflow'],
  sourceOverrideWorkflow?: Source['syncWorkflow'],
) {
  if (!sourceWorkflow || !sourceOverrideWorkflow) return sourceWorkflow ?? sourceOverrideWorkflow
  if (sourceWorkflow.id === sourceOverrideWorkflow.id) {
    if (sourceWorkflow.executionAttempts !== sourceOverrideWorkflow.executionAttempts)
      return sourceWorkflow.executionAttempts > sourceOverrideWorkflow.executionAttempts
        ? sourceWorkflow
        : sourceOverrideWorkflow

    return sourceWorkflow.updatedAt >= sourceOverrideWorkflow.updatedAt
      ? sourceWorkflow
      : sourceOverrideWorkflow
  }
  const sourceWorkflowIsRunning = sourceWorkflowIsActive(sourceWorkflow)
  const sourceOverrideWorkflowIsRunning = sourceWorkflowIsActive(sourceOverrideWorkflow)
  if (sourceWorkflowIsRunning && !sourceOverrideWorkflowIsRunning) return sourceWorkflow
  const createdAtComparison = sourceWorkflow.createdAt.localeCompare(
    sourceOverrideWorkflow.createdAt,
  )
  if (createdAtComparison !== 0)
    return createdAtComparison > 0 ? sourceWorkflow : sourceOverrideWorkflow
  const updatedAtComparison = sourceWorkflow.updatedAt.localeCompare(
    sourceOverrideWorkflow.updatedAt,
  )
  if (updatedAtComparison !== 0)
    return updatedAtComparison > 0 ? sourceWorkflow : sourceOverrideWorkflow
  return sourceWorkflow.id > sourceOverrideWorkflow.id ? sourceWorkflow : sourceOverrideWorkflow
}

function getCurrentSource(source: Source, sourceOverride?: Source) {
  if (!sourceOverride || sourceOverride.id !== source.id) return source
  const sourceVersion = source.version ?? -1
  const overrideVersion = sourceOverride.version ?? -1
  if (sourceVersion > overrideVersion) return source
  const overrideHasNewerSource =
    sourceVersion < overrideVersion || source.updatedAt < sourceOverride.updatedAt
  const sourceHasNewerSource =
    sourceVersion === overrideVersion && source.updatedAt > sourceOverride.updatedAt
  if (sourceHasNewerSource) return source
  const syncWorkflow = overrideHasNewerSource
    ? sourceOverride.syncWorkflow
    : latestSourceWorkflow(source.syncWorkflow, sourceOverride.syncWorkflow)
  if (
    !overrideHasNewerSource &&
    source.syncWorkflow &&
    source.syncWorkflow.id !== sourceOverride.syncWorkflow?.id &&
    syncWorkflow === source.syncWorkflow
  )
    return source
  return {
    ...sourceOverride,
    lastSyncedAt: source.lastSyncedAt ?? sourceOverride.lastSyncedAt,
    status: sourceStatusWithSyncWorkflow(sourceOverride.status, syncWorkflow),
    syncWorkflow,
    syncPolicy: overrideHasNewerSource
      ? (sourceOverride.syncPolicy ?? source.syncPolicy)
      : (source.syncPolicy ?? sourceOverride.syncPolicy),
  }
}

const sourcePollingTimedOutAtom = atom((get) => {
  const timeout = get(sourcePollingTimeoutAtom)
  return timeout.timedOut && timeout.awaitedOperationId === get(sourcesAwaitedOperationIdAtom)
})

const sourcesQueryAtom = atomWithInfiniteQuery((get) => {
  const knowledgeSpaceId = get(sourcesKnowledgeSpaceIdAtom)
  const removedSourceIds = get(removedSourceIdsAtom)
  const sourceOverrides = get(sourceOverridesAtom)
  const awaitedOperationId = get(sourcesAwaitedOperationIdAtom)
  const pollingTimedOut = get(sourcePollingTimedOutAtom)

  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.infiniteOptions({
    input: (pageParam) => ({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        limit: PAGE_SIZE,
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
    refetchInterval: (query) => {
      const currentSources =
        query.state.data?.pages.flatMap((page) =>
          page.data
            .filter((source) => !removedSourceIds.has(source.id))
            .map((source) => getCurrentSource(sourceFromApi(source), sourceOverrides[source.id])),
        ) ?? []
      const phase = initialSourcePollingPhase(currentSources, awaitedOperationId, pollingTimedOut)
      if (phase === 'awaiting') return AWAIT_INITIAL_SOURCE_POLL_INTERVAL

      return currentSources.some(
        (source) =>
          sourceNeedsPolling(source) &&
          (!pollingTimedOut || sourceDisplayStatus(source) !== 'initializing'),
      )
        ? SOURCE_POLL_INTERVAL
        : false
    },
  })
})

const sourcesQueryDataAtom = selectAtom(sourcesQueryAtom, (query) => query.data)
export const sourcesQueryHasDataAtom = atom((get) => Boolean(get(sourcesQueryDataAtom)))
export const sourcesQueryErrorAtom = selectAtom(sourcesQueryAtom, (query) => query.error)
export const sourcesQueryPendingAtom = selectAtom(sourcesQueryAtom, (query) => query.isPending)
export const sourcesQueryHasNextPageAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.hasNextPage,
)
export const sourcesQueryFetchNextPageErrorAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.isFetchNextPageError,
)
export const sourcesQueryFetchingNextPageAtom = selectAtom(
  sourcesQueryAtom,
  (query) => query.isFetchingNextPage,
)

export const currentSourcesAtom = atom((get) => {
  const removedSourceIds = get(removedSourceIdsAtom)
  const sourceOverrides = get(sourceOverridesAtom)
  return (
    get(sourcesQueryDataAtom)
      ?.pages.flatMap((page) => page.data.map((source) => sourceFromApi(source)))
      .filter((source) => !removedSourceIds.has(source.id))
      .map((source) => getCurrentSource(source, sourceOverrides[source.id])) ?? []
  )
})

export const sourcesPollingPhaseAtom = atom((get) =>
  initialSourcePollingPhase(
    get(currentSourcesAtom),
    get(sourcesAwaitedOperationIdAtom),
    get(sourcePollingTimedOutAtom),
  ),
)

export const visibleSourcesAtom = atom((get) =>
  get(currentSourcesAtom)
    .filter((source) => !shouldHidePreviewSource(source))
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    ),
)

export const filteredSourcesAtom = atom((get) => {
  const filter = get(sourcesFilterAtom)
  const search = get(sourcesSearchAtom)
  const sort = get(sourcesSortAtom)
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const nextSources = get(visibleSourcesAtom).filter((source) => {
    if (filter !== 'all' && sourceDisplayStatus(source) !== filter) return false
    if (!normalizedSearch) return true
    return `${source.name} ${source.uri}`.toLocaleLowerCase().includes(normalizedSearch)
  })
  if (!sort) return nextSources
  return [...nextSources].sort((left, right) => {
    const result = left.name.localeCompare(right.name)
    return sort === 'name-asc' ? result : -result
  })
})

const loadedSourcePageCountAtom = atom((get) => get(sourcesQueryDataAtom)?.pages.length ?? 0)
const localTransformActiveAtom = atom((get) =>
  Boolean(
    get(sourcesFilterAtom) !== 'all' || get(sourcesSearchAtom).trim() || get(sourcesSortAtom),
  ),
)
const canAutoLoadNextPageAtom = atom(
  (get) => get(loadedSourcePageCountAtom) < MAX_AUTO_CURSOR_PAGES,
)
const needsVisibleSourceAtom = atom((get) => {
  const latestSourcePage = get(sourcesQueryDataAtom)?.pages.at(-1)
  if (!latestSourcePage) return false
  const removedSourceIds = get(removedSourceIdsAtom)
  const sourceOverrides = get(sourceOverridesAtom)
  return (
    latestSourcePage.data.some((source) =>
      shouldHidePreviewSource(getCurrentSource(sourceFromApi(source), sourceOverrides[source.id])),
    ) &&
    !latestSourcePage.data.some((source) => {
      if (removedSourceIds.has(source.id)) return false
      return !shouldHidePreviewSource(
        getCurrentSource(sourceFromApi(source), sourceOverrides[source.id]),
      )
    })
  )
})

export const completingFilteredResultsAtom = atom((get) => {
  const canAutoLoadNextPage = get(canAutoLoadNextPageAtom)
  const shouldComplete =
    (get(localTransformActiveAtom) && canAutoLoadNextPage) ||
    (get(needsVisibleSourceAtom) && canAutoLoadNextPage)
  return (
    shouldComplete &&
    !get(sourcesQueryFetchNextPageErrorAtom) &&
    (get(sourcesQueryHasNextPageAtom) || get(sourcesQueryFetchingNextPageAtom))
  )
})

export const shouldAutoLoadNextSourcePageAtom = atom(
  (get) =>
    ((get(localTransformActiveAtom) && get(canAutoLoadNextPageAtom)) ||
      (get(needsVisibleSourceAtom) && get(canAutoLoadNextPageAtom))) &&
    get(sourcesQueryHasNextPageAtom) &&
    !get(sourcesQueryFetchingNextPageAtom) &&
    !get(sourcesQueryFetchNextPageErrorAtom),
)

export const acceptSourceSnapshotAtom = atom(null, (_get, set, source: Source) => {
  set(sourceOverridesAtom, (current) => ({ ...current, [source.id]: source }))
})

export const removeSourceFromListAtom = atom(null, (_get, set, sourceId: string) => {
  set(removedSourceIdsAtom, (current) => new Set(current).add(sourceId))
})

export const markSourcePollingTimedOutAtom = atom(null, (get, set) => {
  set(sourcePollingTimeoutAtom, {
    awaitedOperationId: get(sourcesAwaitedOperationIdAtom),
    timedOut: true,
  })
})

export const refreshSourcesAtom = atom(null, (get) => get(sourcesQueryAtom).refetch())
export const fetchNextSourcePageAtom = atom(null, (get) => get(sourcesQueryAtom).fetchNextPage())

export const sourcesSessionAtoms = [
  sourceOverridesAtom,
  removedSourceIdsAtom,
  sourcePollingTimeoutAtom,
] as const
