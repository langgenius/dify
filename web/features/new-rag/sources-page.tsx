'use client'

import type { SourceFilter } from './source-list-query-state'
import type { Source } from './source-models'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import Link from '@/next/link'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessBanner } from './components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { useKnowledgeSpacePermission } from './knowledge-space-context'
import { newKnowledgeAddSourcePath } from './routes'
import { SourceRow } from './source-list-item'
import { sourceTableGridClass } from './source-list-layout'
import { sourceFilterParser, sourceSearchParser, sourceSortParser } from './source-list-query-state'
import {
  initialSourcePollingPhase,
  isInitialSourceForOperation,
  shouldHidePreviewSource,
  sourceDisplayStatus,
  sourceFromApi,
  sourceNeedsPolling,
  sourceStatusWithSyncWorkflow,
  sourceWorkflowIsActive,
} from './source-models'
import { SourcesEmpty } from './sources-empty'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'

const PAGE_SIZE = 200
const MAX_AUTO_CURSOR_PAGES = 5
const AWAIT_INITIAL_SOURCE_POLL_INTERVAL = 2000
const SOURCE_POLL_INTERVAL = 3000
const INITIAL_SOURCE_POLL_TIMEOUT = 10 * 60 * 1000

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
  // The server snapshot ranks active runs first, so an active server run remains authoritative
  // even when it is an older run being retried. A local active override still has to be newer
  // than a terminal server run, otherwise it could remain stuck after a later run completes.
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

export function SourcesPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const ensureSourceSyncReady = useCallback(
    async () =>
      (await ensureModelReady({ capability: 'source_sync', intent: 'source-sync' })).status ===
      'ready',
    [ensureModelReady],
  )
  const canManageSources = useKnowledgeSpacePermission('knowledge_space_document_write')
  const [filter, setFilter] = useQueryState('status', sourceFilterParser)
  const [search, setSearch] = useQueryState('query', sourceSearchParser)
  const [sort, setSort] = useQueryState('sort', sourceSortParser)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, Source>>({})
  const [removedSourceIds, setRemovedSourceIds] = useState<Set<string>>(() => new Set())
  const [initialSourcePollingTimedOut, setInitialSourcePollingTimedOut] = useState(false)
  const initialSourcePollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const normalizedAwaitedOperationId = searchParams.get('awaitInitialSource')?.trim() || null
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.infiniteOptions({
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
        const phase = initialSourcePollingPhase(
          currentSources,
          normalizedAwaitedOperationId,
          initialSourcePollingTimedOut,
        )
        if (phase === 'awaiting') return AWAIT_INITIAL_SOURCE_POLL_INTERVAL

        return currentSources.some(
          (source) =>
            sourceNeedsPolling(source) &&
            (!initialSourcePollingTimedOut || sourceDisplayStatus(source) !== 'initializing'),
        )
          ? SOURCE_POLL_INTERVAL
          : false
      },
    }),
  )
  const remoteSources = sourcesQuery.data?.pages.flatMap((page) => page.data.map(sourceFromApi))
  const currentSources = useMemo(
    () =>
      (remoteSources ?? [])
        .filter((source) => !removedSourceIds.has(source.id))
        .map((source) => getCurrentSource(source, sourceOverrides[source.id])),
    [remoteSources, removedSourceIds, sourceOverrides],
  )
  const pollingPhase = initialSourcePollingPhase(
    currentSources,
    normalizedAwaitedOperationId,
    initialSourcePollingTimedOut,
  )
  const initialSourcePollingActive = pollingPhase === 'awaiting' || pollingPhase === 'initializing'
  const waitingForInitialSource = pollingPhase === 'awaiting'
  const sources = useMemo(
    () =>
      currentSources
        .filter((source) => !shouldHidePreviewSource(source))
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        ),
    [currentSources],
  )
  const filteredSources = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const nextSources = (sources ?? []).filter((source) => {
      if (filter !== 'all' && sourceDisplayStatus(source) !== filter) return false
      if (!normalizedSearch) return true
      return `${source.name} ${source.uri}`.toLocaleLowerCase().includes(normalizedSearch)
    })
    if (!sort) return nextSources
    return [...nextSources].sort((left, right) => {
      const result = left.name.localeCompare(right.name)
      return sort === 'name-asc' ? result : -result
    })
  }, [filter, search, sort, sources])
  const localTransformActive = filter !== 'all' || Boolean(search.trim()) || Boolean(sort)
  const loadedSourcePageCount = sourcesQuery.data?.pages.length ?? 0
  const canAutoLoadNextPage = loadedSourcePageCount < MAX_AUTO_CURSOR_PAGES
  const canAutoCompleteFilteredResults = localTransformActive && canAutoLoadNextPage
  const latestSourcePage = sourcesQuery.data?.pages.at(-1)
  const needsVisibleSource =
    latestSourcePage !== undefined &&
    latestSourcePage.data.some((source) =>
      shouldHidePreviewSource(getCurrentSource(sourceFromApi(source), sourceOverrides[source.id])),
    ) &&
    !latestSourcePage.data.some((source) => {
      if (removedSourceIds.has(source.id)) return false
      return !shouldHidePreviewSource(
        getCurrentSource(sourceFromApi(source), sourceOverrides[source.id]),
      )
    })
  const completingFilteredResults =
    (canAutoCompleteFilteredResults || (needsVisibleSource && canAutoLoadNextPage)) &&
    !sourcesQuery.isFetchNextPageError &&
    (sourcesQuery.hasNextPage || sourcesQuery.isFetchingNextPage)
  const allFilteredSourcesSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.has(source.id))
  const someFilteredSourcesSelected = filteredSources.some((source) =>
    selectedSourceIds.has(source.id),
  )
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchingNextPage: isFetchingNextSourcePage,
  } = sourcesQuery

  useEffect(() => {
    if (
      normalizedAwaitedOperationId &&
      currentSources.some((source) =>
        isInitialSourceForOperation(source, normalizedAwaitedOperationId),
      )
    ) {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('awaitInitialSource')
      const queryString = nextSearchParams.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
    }
  }, [currentSources, normalizedAwaitedOperationId, pathname, router, searchParams])

  useEffect(() => {
    if (!initialSourcePollingActive) {
      globalThis.clearTimeout(initialSourcePollingTimeoutRef.current)
      initialSourcePollingTimeoutRef.current = undefined
      return
    }
    if (initialSourcePollingTimeoutRef.current) return

    initialSourcePollingTimeoutRef.current = globalThis.setTimeout(() => {
      initialSourcePollingTimeoutRef.current = undefined
      setInitialSourcePollingTimedOut(true)
    }, INITIAL_SOURCE_POLL_TIMEOUT)
  }, [initialSourcePollingActive])

  useEffect(() => () => globalThis.clearTimeout(initialSourcePollingTimeoutRef.current), [])

  useEffect(() => {
    if (
      (canAutoCompleteFilteredResults || (needsVisibleSource && canAutoLoadNextPage)) &&
      hasNextSourcePage &&
      !isFetchingNextSourcePage &&
      !sourcesQuery.isFetchNextPageError
    )
      void fetchNextSourcePage()
  }, [
    canAutoCompleteFilteredResults,
    canAutoLoadNextPage,
    fetchNextSourcePage,
    hasNextSourcePage,
    isFetchingNextSourcePage,
    needsVisibleSource,
    sourcesQuery.isFetchNextPageError,
  ])

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col p-4 @min-[768px]/knowledge-content:p-6 @min-[1280px]/knowledge-content:p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="title-xl-semi-bold leading-6 text-text-primary">
            {t(($) => $['newKnowledge.sources'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesDescription'])}
          </p>
        </div>
        {pollingPhase === 'timed-out' && (
          <Button onClick={() => void sourcesQuery.refetch()}>
            <span aria-hidden className="i-ri-refresh-line size-4" />
            {t(($) => $['newKnowledge.refreshSources'])}
          </Button>
        )}
      </header>
      <KnowledgeModelReadinessBanner
        capability="source_sync"
        className="mt-4"
        knowledgeSpaceId={knowledgeSpaceId}
      />
      {waitingForInitialSource && sources.length > 0 && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-background-section-burn px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span
            aria-hidden
            className="i-ri-loader-4-line size-3.5 animate-spin motion-reduce:animate-none"
          />
          {t(($) => $['newKnowledge.awaitingInitialSource'])}
        </div>
      )}
      {sourcesQuery.isPending ? (
        <div className="flex min-h-64 flex-1 items-center justify-center">
          <Loading />
        </div>
      ) : sourcesQuery.error && !sourcesQuery.data ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center">
          <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
          <h2 className="mt-3 title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.sourcesErrorTitle'])}
          </h2>
          <p className="mt-2 body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesErrorDescription'])}
          </p>
          <Button className="mt-4" onClick={() => void sourcesQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : waitingForInitialSource && !sources?.length ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Loading />
          <p className="body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.awaitingInitialSource'])}
          </p>
        </div>
      ) : !sources?.length && !sourcesQuery.hasNextPage ? (
        <SourcesEmpty canAddSource={canManageSources} knowledgeSpaceId={knowledgeSpaceId} />
      ) : (
        <>
          <div className="mt-8.5 flex flex-col gap-2 @min-[768px]/knowledge-content:flex-row">
            <Select<SourceFilter>
              value={filter}
              onValueChange={(value) => {
                if (value) void setFilter(value)
              }}
            >
              <SelectLabel className="sr-only">
                {t(($) => $['newKnowledge.sourceFilterLabel'])}
              </SelectLabel>
              <SelectTrigger className="@min-[768px]/knowledge-content:w-35">
                {filter === 'all'
                  ? t(($) => $['newKnowledge.allSources'])
                  : t(($) => $[`newKnowledge.sourceStatus.${filter}`])}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <SelectItemText>{t(($) => $['newKnowledge.allSources'])}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
                {(['active', 'initializing', 'syncing', 'disabled', 'error'] as const).map(
                  (status) => (
                    <SelectItem key={status} value={status}>
                      <SelectItemText>
                        {t(($) => $[`newKnowledge.sourceStatus.${status}`])}
                      </SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <SearchInput
              aria-label={t(($) => $['newKnowledge.searchSources'])}
              className="@min-[768px]/knowledge-content:w-60"
              value={search}
              onValueChange={(value) => void setSearch(value)}
              placeholder={t(($) => $['newKnowledge.searchSources'])}
            />
            {canManageSources && (
              <Link
                href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
                className={buttonVariants({
                  className: 'gap-1 @min-[768px]/knowledge-content:ml-auto',
                  variant: 'primary',
                })}
              >
                <span aria-hidden className="i-ri-add-line size-4" />
                {t(($) => $['newKnowledge.addSource'])}
              </Link>
            )}
          </div>
          <div className="mt-3 min-w-0">
            <table className="relative block w-full text-left">
              <thead className="absolute size-px overflow-hidden text-[11px] leading-4 font-medium tracking-[0.3px] whitespace-nowrap text-text-tertiary uppercase [clip:rect(0,0,0,0)] @min-[768px]/knowledge-content:static @min-[768px]/knowledge-content:block @min-[768px]/knowledge-content:size-auto @min-[768px]/knowledge-content:overflow-visible @min-[768px]/knowledge-content:whitespace-normal @min-[768px]/knowledge-content:[clip:auto]">
                <tr className={cn(sourceTableGridClass, 'py-2.5')}>
                  <th className="flex items-center">
                    <Checkbox
                      aria-label={tCommon(($) => $['operation.selectAll'])}
                      checked={allFilteredSourcesSelected}
                      indeterminate={someFilteredSourcesSelected && !allFilteredSourcesSelected}
                      onCheckedChange={(checked) => {
                        setSelectedSourceIds((current) => {
                          const next = new Set(current)
                          for (const source of filteredSources) {
                            if (checked) next.add(source.id)
                            else next.delete(source.id)
                          }
                          return next
                        })
                      }}
                    />
                  </th>
                  <th
                    aria-sort={
                      sort === 'name-asc'
                        ? 'ascending'
                        : sort === 'name-desc'
                          ? 'descending'
                          : 'none'
                    }
                    className="min-w-0 @min-[768px]/knowledge-content:col-start-2 @min-[960px]/knowledge-content:col-start-auto"
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => void setSort(sort === 'name-asc' ? 'name-desc' : 'name-asc')}
                      className="h-auto gap-1 rounded px-0 text-[11px] leading-4 font-medium tracking-[0.3px] focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    >
                      {t(($) => $['newKnowledge.sourceColumn'])}
                      {sort && (
                        <span
                          aria-hidden
                          className={cn(
                            'size-3.5',
                            sort === 'name-desc' ? 'i-ri-arrow-down-line' : 'i-ri-arrow-up-line',
                          )}
                        />
                      )}
                    </Button>
                  </th>
                  <th className="hidden min-w-0 @min-[960px]/knowledge-content:block">
                    {t(($) => $['metadata.createMetadata.type'])}
                  </th>
                  <th className="min-w-0 @min-[768px]/knowledge-content:col-start-3 @min-[960px]/knowledge-content:col-start-auto">
                    {t(($) => $['newKnowledge.statusColumn'])}
                  </th>
                  <th className="hidden min-w-0 @min-[960px]/knowledge-content:block">
                    {t(($) => $['newKnowledge.syncPolicyColumn'])}
                  </th>
                  <th className="min-w-0 @min-[768px]/knowledge-content:col-start-4 @min-[960px]/knowledge-content:col-start-auto">
                    {t(($) => $['newKnowledge.lastSyncColumn'])}
                  </th>
                  <th
                    className="@min-[768px]/knowledge-content:col-start-5 @min-[960px]/knowledge-content:col-start-auto"
                    aria-label={t(($) => $['newKnowledge.actionsColumn'])}
                  />
                </tr>
              </thead>
              <tbody className="block space-y-2 @min-[768px]/knowledge-content:space-y-0">
                {filteredSources.map((source) => (
                  <SourceRow
                    key={source.id}
                    canEdit={canManageSources}
                    canSync={canManageSources}
                    checked={selectedSourceIds.has(source.id)}
                    ensureModelSetupReady={ensureSourceSyncReady}
                    knowledgeSpaceId={knowledgeSpaceId}
                    source={source}
                    onRemoved={() => {
                      setRemovedSourceIds((current) => new Set(current).add(source.id))
                      setSelectedSourceIds((current) => {
                        if (!current.has(source.id)) return current
                        const next = new Set(current)
                        next.delete(source.id)
                        return next
                      })
                    }}
                    onSourceChange={(updatedSource) =>
                      setSourceOverrides((current) => ({
                        ...current,
                        [updatedSource.id]: updatedSource,
                      }))
                    }
                    onCheckedChange={(checked) => {
                      setSelectedSourceIds((current) => {
                        const next = new Set(current)
                        if (checked) next.add(source.id)
                        else next.delete(source.id)
                        return next
                      })
                    }}
                  />
                ))}
              </tbody>
            </table>
            {!filteredSources.length &&
              !sourcesQuery.hasNextPage &&
              !completingFilteredResults &&
              !sourcesQuery.isFetchNextPageError && (
                <p className="py-16 text-center body-sm-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.noMatchingSources'])}
                </p>
              )}
            {!filteredSources.length && completingFilteredResults && (
              <div className="flex min-h-40 items-center justify-center">
                <Loading />
              </div>
            )}
          </div>
          {sourcesQuery.isFetchNextPageError ? (
            <div className="mt-5 flex items-center justify-center gap-3" role="alert">
              <span className="system-xs-regular text-text-destructive">
                {t(($) => $['newKnowledge.sourcesErrorDescription'])}
              </span>
              <Button onClick={() => void sourcesQuery.fetchNextPage()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            </div>
          ) : sourcesQuery.hasNextPage && !completingFilteredResults ? (
            <div className="mt-5 flex justify-center">
              <Button
                loading={sourcesQuery.isFetchingNextPage}
                onClick={() => void sourcesQuery.fetchNextPage()}
              >
                {t(($) => $['newKnowledge.loadMore'])}
              </Button>
            </div>
          ) : null}
        </>
      )}
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </div>
  )
}
