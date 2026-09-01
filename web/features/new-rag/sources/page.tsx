'use client'

import type { SourceFilter } from './source-list-query-state'
import type { Source } from './source-models'
import type { SourceSort } from './state'
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
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import Link from '@/next/link'
import { useSearchParams } from '@/next/navigation'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { newKnowledgeAddSourcePath } from '../routes'
import { useKnowledgeSpacePermission } from '../space/context'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { SourcesEmpty } from './empty'
import { SourcesRuntimeController } from './runtime-controller'
import { SourceRow } from './source-list-item'
import { sourceTableGridClass } from './source-list-layout'
import { sourceFilterParser, sourceSearchParser, sourceSortParser } from './source-list-query-state'
import {
  completingFilteredResultsAtom,
  fetchNextSourcePageAtom,
  filteredSourcesAtom,
  refreshSourcesAtom,
  sourcesFilterAtom,
  sourcesKnowledgeSpaceIdAtom,
  sourcesPollingPhaseAtom,
  sourcesQueryErrorAtom,
  sourcesQueryFetchingNextPageAtom,
  sourcesQueryFetchNextPageErrorAtom,
  sourcesQueryHasDataAtom,
  sourcesQueryHasNextPageAtom,
  sourcesQueryPendingAtom,
  sourcesSearchAtom,
  sourcesSortAtom,
  visibleSourcesAtom,
} from './state'
import { SourcesStateBoundary } from './state-boundary'

export function SourcesPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const searchParams = useSearchParams()
  const [filter, setFilter] = useQueryState('status', sourceFilterParser)
  const [search, setSearch] = useQueryState('query', sourceSearchParser)
  const [sort, setSort] = useQueryState('sort', sourceSortParser)
  const awaitedOperationId = searchParams.get('awaitInitialSource')?.trim() || null

  return (
    <SourcesStateBoundary
      awaitedOperationId={awaitedOperationId}
      filter={filter}
      knowledgeSpaceId={knowledgeSpaceId}
      search={search}
      sort={sort}
    >
      <SourcesPageContent
        onFilterChange={(value) => void setFilter(value)}
        onSearchChange={(value) => void setSearch(value)}
        onSortChange={(value) => void setSort(value)}
      />
    </SourcesStateBoundary>
  )
}

function SourcesPageContent({
  onFilterChange,
  onSearchChange,
  onSortChange,
}: {
  onFilterChange: (value: SourceFilter) => void
  onSearchChange: (value: string) => void
  onSortChange: (value: SourceSort) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const knowledgeSpaceId = useAtomValue(sourcesKnowledgeSpaceIdAtom)
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
  const filter = useAtomValue(sourcesFilterAtom)
  const search = useAtomValue(sourcesSearchAtom)
  const sort = useAtomValue(sourcesSortAtom)
  const pollingPhase = useAtomValue(sourcesPollingPhaseAtom)
  const waitingForInitialSource = pollingPhase === 'awaiting'
  const sources = useAtomValue(visibleSourcesAtom)
  const filteredSources = useAtomValue(filteredSourcesAtom)
  const completingFilteredResults = useAtomValue(completingFilteredResultsAtom)
  const sourcesQueryPending = useAtomValue(sourcesQueryPendingAtom)
  const sourcesQueryError = useAtomValue(sourcesQueryErrorAtom)
  const sourcesQueryHasData = useAtomValue(sourcesQueryHasDataAtom)
  const sourcesQueryHasNextPage = useAtomValue(sourcesQueryHasNextPageAtom)
  const sourcesQueryFetchNextPageError = useAtomValue(sourcesQueryFetchNextPageErrorAtom)
  const sourcesQueryFetchingNextPage = useAtomValue(sourcesQueryFetchingNextPageAtom)
  const refreshSources = useSetAtom(refreshSourcesAtom)
  const fetchNextSourcePage = useSetAtom(fetchNextSourcePageAtom)
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col px-6 pt-3 pb-6 sm:pb-8">
      <SourcesRuntimeController />
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
          <Button onClick={() => void refreshSources()}>
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
      {sourcesQueryPending ? (
        <div className="flex min-h-64 flex-1 items-center justify-center">
          <Loading />
        </div>
      ) : sourcesQueryError && !sourcesQueryHasData ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center">
          <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
          <h2 className="mt-3 title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.sourcesErrorTitle'])}
          </h2>
          <p className="mt-2 body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesErrorDescription'])}
          </p>
          <Button className="mt-4" onClick={() => void refreshSources()}>
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
      ) : !sources?.length && !sourcesQueryHasNextPage ? (
        <SourcesEmpty canAddSource={canManageSources} knowledgeSpaceId={knowledgeSpaceId} />
      ) : (
        <>
          <div className="mt-8.5 flex flex-col gap-2 @min-[768px]/knowledge-content:flex-row">
            <Select<SourceFilter>
              value={filter}
              onValueChange={(value) => {
                if (value) onFilterChange(value)
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
              onValueChange={onSearchChange}
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
          <SourcesTable
            completingFilteredResults={completingFilteredResults}
            ensureModelSetupReady={ensureSourceSyncReady}
            filteredSources={filteredSources}
            hasNextPage={sourcesQueryHasNextPage}
            isFetchNextPageError={sourcesQueryFetchNextPageError}
            sort={sort}
            onSortChange={onSortChange}
          />
          {sourcesQueryFetchNextPageError ? (
            <div className="mt-5 flex items-center justify-center gap-3" role="alert">
              <span className="system-xs-regular text-text-destructive">
                {t(($) => $['newKnowledge.sourcesErrorDescription'])}
              </span>
              <Button onClick={() => void fetchNextSourcePage()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            </div>
          ) : sourcesQueryHasNextPage && !completingFilteredResults ? (
            <div className="mt-5 flex justify-center">
              <Button
                loading={sourcesQueryFetchingNextPage}
                onClick={() => void fetchNextSourcePage()}
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

function SourcesTable({
  completingFilteredResults,
  ensureModelSetupReady,
  filteredSources,
  hasNextPage,
  isFetchNextPageError,
  onSortChange,
  sort,
}: {
  completingFilteredResults: boolean
  ensureModelSetupReady: () => Promise<boolean>
  filteredSources: Source[]
  hasNextPage: boolean
  isFetchNextPageError: boolean
  onSortChange: (value: SourceSort) => void
  sort: SourceSort
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const allFilteredSourcesSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.has(source.id))
  const someFilteredSourcesSelected = filteredSources.some((source) =>
    selectedSourceIds.has(source.id),
  )

  return (
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
                sort === 'name-asc' ? 'ascending' : sort === 'name-desc' ? 'descending' : 'none'
              }
              className="min-w-0 @min-[768px]/knowledge-content:col-start-2 @min-[960px]/knowledge-content:col-start-auto"
            >
              <Button
                variant="ghost"
                size="small"
                onClick={() => onSortChange(sort === 'name-asc' ? 'name-desc' : 'name-asc')}
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
              checked={selectedSourceIds.has(source.id)}
              ensureModelSetupReady={ensureModelSetupReady}
              source={source}
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
        !hasNextPage &&
        !completingFilteredResults &&
        !isFetchNextPageError && (
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
  )
}
