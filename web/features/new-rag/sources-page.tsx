'use client'

import type { Source } from '@dify/contracts/knowledge-fs/types.gen'
import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { newKnowledgeAddSourcePath } from './routes'

type SourceStatus = Source['status']
type SourceFilter = SourceStatus | 'all'

const PAGE_SIZE = 50

const statusDotStatus: Record<SourceStatus, StatusDotStatus> = {
  active: 'success',
  syncing: 'normal',
  disabled: 'disabled',
  error: 'error',
}

function metadataString(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isPreviewDraft(source: Source) {
  return source.metadata.preview === true && source.status === 'disabled'
}

function SourceActions({ source }: { source: Source }) {
  const { t } = useTranslation('dataset')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t(($) => $['newKnowledge.sourceActions'], { name: source.name })}
        className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
        <DropdownMenuItem disabled className="gap-2 px-3">
          <span aria-hidden className="i-ri-refresh-line size-4" />
          {t(($) => $['newKnowledge.syncNow'])}
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2 px-3">
          <span aria-hidden className="i-ri-edit-line size-4" />
          {t(($) => $['newKnowledge.editSource'])}
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2 px-3">
          <span aria-hidden className="i-ri-indeterminate-circle-line size-4" />
          {t(($) => $['newKnowledge.disableSource'])}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled variant="destructive" className="gap-2 px-3">
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          {t(($) => $['newKnowledge.removeSource'])}
        </DropdownMenuItem>
        <p className="px-3 py-2 system-2xs-regular text-text-tertiary" role="status">
          {t(($) => $['cornerLabel.unavailable'])}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SourceRow({
  onSelectedChange,
  selected,
  source,
}: {
  onSelectedChange: (sourceId: string) => void
  selected: boolean
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const providerName = metadataString(source.metadata, 'providerName')
  const syncPolicy = metadataString(source.metadata, 'syncPolicy')
  const lastSync = metadataString(source.metadata, 'lastSyncedAt')
  const typeLabel = t(($) => $[`newKnowledge.sourceType.${source.type}`])
  const titleId = `new-source-${source.id}`

  return (
    <tr
      className={cn('border-t border-divider-subtle', source.status === 'disabled' && 'opacity-60')}
    >
      <td className="w-10 py-2 pr-3">
        <Checkbox
          checked={selected}
          aria-labelledby={titleId}
          onCheckedChange={() => onSelectedChange(source.id)}
        />
      </td>
      <td className="min-w-0 py-2 pr-3 sm:min-w-64">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              'size-[18px] shrink-0 text-text-tertiary',
              source.type === 'web' ? 'i-ri-global-line' : 'i-ri-links-line',
            )}
          />
          <p
            id={titleId}
            title={source.uri}
            className="min-w-0 truncate system-xs-medium text-text-primary"
          >
            {source.name}
          </p>
        </div>
      </td>
      <td className="hidden w-44 py-2 pr-3 sm:table-cell">
        <p className="system-xs-regular text-text-secondary">{providerName ?? typeLabel}</p>
        {providerName && <p className="system-2xs-regular text-text-tertiary">{typeLabel}</p>}
      </td>
      <td className="w-24 py-2 pr-3 sm:w-32">
        <span className="inline-flex items-center gap-1.5 system-xs-medium text-text-secondary">
          <StatusDot
            status={statusDotStatus[source.status]}
            className={cn(
              'shrink-0',
              source.status === 'syncing' && 'animate-pulse motion-reduce:animate-none',
            )}
          />
          {t(($) => $[`newKnowledge.sourceStatus.${source.status}`])}
        </span>
      </td>
      <td className="hidden w-32 py-2 pr-3 system-xs-regular text-text-secondary lg:table-cell">
        {syncPolicy ?? '—'}
      </td>
      <td className="hidden w-40 py-2 pr-3 system-xs-regular text-text-secondary lg:table-cell">
        {lastSync ?? '—'}
      </td>
      <td className="w-12 py-2 text-right">
        <SourceActions source={source} />
      </td>
    </tr>
  )
}

function SourcesEmpty({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div aria-hidden className="flex items-center gap-3">
        <svg data-brand="firecrawl" viewBox="0 0 28 40" className="size-5">
          <path
            fill="#FA5D19"
            d="M23.36 12.83c-1.55.46-2.71 1.5-3.57 2.62-.18.25-.56.07-.49-.23 1.64-6.73-.52-12.31-7.26-15.07-.34-.14-.7.17-.6.53C14.5 12.98 1.61 11.94 3.24 25.88c.03.24-.24.41-.44.27-.6-.44-1.29-1.36-1.75-2-.14-.19-.44-.14-.5.09A14.3 14.3 0 0 0 0 28.12c0 4.9 2.52 9.21 6.33 11.71.22.14.5-.06.42-.31a7.7 7.7 0 0 1-.31-2.08c0-.44.03-.89.1-1.31.16-1.06.52-2.06 1.14-2.97 2.11-3.17 6.35-6.24 5.67-10.4-.04-.26.27-.43.46-.25 2.99 2.72 3.58 6.39 3.09 9.68-.05.28.31.44.49.21.46-.57 1.01-1.07 1.62-1.45.15-.09.35-.02.41.15.34.98.84 1.9 1.31 2.82.57 1.11.87 2.37.82 3.71a7.7 7.7 0 0 1-.31 1.88c-.08.26.2.47.42.32A14 14 0 0 0 28 28.12c0-1.71-.3-3.38-.86-4.94-1.19-3.29-4.19-5.75-3.43-10.03.04-.2-.15-.38-.35-.32Z"
          />
        </svg>
        <span data-brand="jina" className="i-custom-public-llm-jina size-5" />
        <span
          data-brand="notion"
          className="i-custom-public-common-notion size-5 text-text-primary"
        />
        <svg data-brand="google-drive" viewBox="0 0 24 24" className="size-5">
          <path fill="#0F9D58" d="M8.2 3h5.1l7.6 13.2h-5.1z" />
          <path fill="#F4B400" d="M8.2 3 .7 16.2l2.6 4.5 7.5-13.2z" />
          <path fill="#4285F4" d="M3.3 20.7h15.2l2.4-4.5H5.9z" />
        </svg>
        <svg data-brand="confluence" viewBox="0 0 24 24" className="size-5 text-blue-600">
          <path
            fill="currentColor"
            d="M4.1 15.7c-.4.7-.8 1.5-1.1 2.1-.2.5 0 1 .5 1.3l3.4 1.6c.5.2 1 0 1.3-.4.3-.6.7-1.3 1.1-2 2.9-4.8 5.9-4.2 11.1-1.8.5.2 1.1 0 1.3-.5l1.3-3.5c.2-.5-.1-1.1-.6-1.3-7.6-3.5-13.8-3.6-18.3 4.5Z"
          />
          <path
            fill="currentColor"
            opacity=".55"
            d="M19.9 8.3c.4-.7.8-1.5 1.1-2.1.2-.5 0-1-.5-1.3l-3.4-1.6c-.5-.2-1 0-1.3.4-.3.6-.7 1.3-1.1 2-2.9 4.8-5.9 4.2-11.1 1.8-.5-.2-1.1 0-1.3.5L1 11.5c-.2.5.1 1.1.6 1.3 7.6 3.5 13.8 3.6 18.3-4.5Z"
          />
        </svg>
        <svg data-brand="dropbox" viewBox="0 0 24 24" className="size-5 text-blue-500">
          <path
            fill="currentColor"
            d="m7 3-5 3.2L7 9.4l5-3.2L7 3Zm10 0-5 3.2 5 3.2 5-3.2L17 3ZM7 10.6l-5 3.2L7 17l5-3.2-5-3.2Zm10 0-5 3.2 5 3.2 5-3.2-5-3.2ZM7.2 18.1l4.8 3 4.8-3-4.8-3-4.8 3Z"
          />
        </svg>
      </div>
      <h2 className="mt-5 title-xl-semi-bold text-text-primary">
        {t(($) => $['newKnowledge.sourcesEmptyTitle'])}
      </h2>
      <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
        {t(($) => $['newKnowledge.sourcesEmptyDescription'])}
      </p>
      <Link
        href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
        className="mt-5 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['newKnowledge.addSource'])}
      </Link>
    </div>
  )
}

export function SourcesPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.infiniteOptions({
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.items.some((source) => source.status === 'syncing'),
        )
          ? 2000
          : false,
    }),
  )
  const sources = useMemo(
    () =>
      sourcesQuery.data
        ? sourcesQuery.data.pages
            .flatMap((page) => page.items)
            .filter((source) => !isPreviewDraft(source))
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )
        : undefined,
    [sourcesQuery.data],
  )
  const filteredSources = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return (sources ?? []).filter((source) => {
      if (filter !== 'all' && source.status !== filter) return false
      if (!normalizedSearch) return true
      return `${source.name} ${source.uri}`.toLocaleLowerCase().includes(normalizedSearch)
    })
  }, [filter, search, sources])
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const allFilteredSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.has(source.id))
  const someFilteredSelected = filteredSources.some((source) => selectedSourceIds.has(source.id))
  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }
  const toggleAllSources = () => {
    setSelectedSourceIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected) {
        for (const source of filteredSources) next.delete(source.id)
      } else {
        for (const source of filteredSources) next.add(source.id)
      }
      return next
    })
  }
  const latestSourcePage = sourcesQuery.data?.pages[sourcesQuery.data.pages.length - 1]
  const needsVisibleSource =
    latestSourcePage !== undefined &&
    !latestSourcePage.items.some((source) => !isPreviewDraft(source))
  const completingFilteredResults =
    filterActive &&
    !sourcesQuery.isFetchNextPageError &&
    (sourcesQuery.hasNextPage || sourcesQuery.isFetchingNextPage)
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchingNextPage: isFetchingNextSourcePage,
  } = sourcesQuery

  useEffect(() => {
    if (
      (filterActive || needsVisibleSource) &&
      hasNextSourcePage &&
      !isFetchingNextSourcePage &&
      !sourcesQuery.isFetchNextPageError
    )
      void fetchNextSourcePage()
  }, [
    filterActive,
    fetchNextSourcePage,
    hasNextSourcePage,
    isFetchingNextSourcePage,
    needsVisibleSource,
    sourcesQuery.isFetchNextPageError,
  ])

  return (
    <main className="flex min-h-full flex-col px-4 py-6 sm:px-8 sm:py-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.sources'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesDescription'])}
          </p>
        </div>
        {!!sources?.length && (
          <Link
            href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['newKnowledge.addSource'])}
          </Link>
        )}
      </header>
      {sourcesQuery.isPending ? (
        <div className="flex min-h-64 flex-1 items-center justify-center">
          <Loading />
        </div>
      ) : sourcesQuery.error && !sourcesQuery.data ? (
        <div
          className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
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
      ) : !sources?.length && sourcesQuery.isFetchNextPageError ? (
        <div className="flex min-h-64 flex-1 items-center justify-center gap-3" role="alert">
          <span className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.sourcesErrorDescription'])}
          </span>
          <Button onClick={() => void sourcesQuery.fetchNextPage()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : !sources?.length && (sourcesQuery.hasNextPage || sourcesQuery.isFetchingNextPage) ? (
        <div className="flex min-h-64 flex-1 items-center justify-center">
          <Loading />
        </div>
      ) : !sources?.length ? (
        <SourcesEmpty knowledgeSpaceId={knowledgeSpaceId} />
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="source-filter">
              {t(($) => $['newKnowledge.sourceFilterLabel'])}
            </label>
            <select
              id="source-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as SourceFilter)}
              className="h-8 rounded-lg border-0 bg-components-input-bg-normal px-3 system-xs-regular text-text-secondary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
            >
              <option value="all">{t(($) => $['newKnowledge.allSources'])}</option>
              {(['active', 'syncing', 'disabled', 'error'] as const).map((status) => (
                <option key={status} value={status}>
                  {t(($) => $[`newKnowledge.sourceStatus.${status}`])}
                </option>
              ))}
            </select>
            <label className="relative sm:w-64">
              <span className="sr-only">{t(($) => $['newKnowledge.searchSources'])}</span>
              <span
                aria-hidden
                className="pointer-events-none absolute top-2 left-2.5 i-ri-search-line size-4 text-text-quaternary"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t(($) => $['newKnowledge.searchSources'])}
                className="h-8 w-full rounded-lg border-0 bg-components-input-bg-normal pr-3 pl-8 system-xs-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
              />
            </label>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left lg:min-w-[900px] lg:table-auto">
              <thead className="system-2xs-medium text-text-tertiary uppercase">
                <tr>
                  <th className="w-10 pb-2 font-medium">
                    <Checkbox
                      checked={allFilteredSelected}
                      indeterminate={someFilteredSelected && !allFilteredSelected}
                      disabled={!filteredSources.length}
                      aria-label={t(($) => $['newKnowledge.selectAllSources'])}
                      onCheckedChange={toggleAllSources}
                    />
                  </th>
                  <th className="pb-2 font-medium">{t(($) => $['newKnowledge.sourceColumn'])}</th>
                  <th className="hidden pb-2 font-medium sm:table-cell">
                    {t(($) => $['metadata.createMetadata.type'])}
                  </th>
                  <th className="pb-2 font-medium">{t(($) => $['newKnowledge.statusColumn'])}</th>
                  <th className="hidden pb-2 font-medium lg:table-cell">
                    {t(($) => $['newKnowledge.syncPolicyColumn'])}
                  </th>
                  <th className="hidden pb-2 font-medium lg:table-cell">
                    {t(($) => $['newKnowledge.lastSyncColumn'])}
                  </th>
                  <th aria-label={t(($) => $['newKnowledge.actionsColumn'])} />
                </tr>
              </thead>
              <tbody>
                {filteredSources.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    selected={selectedSourceIds.has(source.id)}
                    onSelectedChange={toggleSource}
                  />
                ))}
              </tbody>
            </table>
            {!filteredSources.length &&
              !completingFilteredResults &&
              !sourcesQuery.isFetchNextPageError && (
                <p
                  aria-live="polite"
                  className="py-16 text-center body-sm-regular text-text-tertiary"
                  role="status"
                >
                  {t(($) => $['newKnowledge.noMatchingSources'])}
                </p>
              )}
            {completingFilteredResults && (
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
          ) : sourcesQuery.hasNextPage && !filterActive ? (
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
    </main>
  )
}
