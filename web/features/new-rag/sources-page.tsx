'use client'

import type { Source } from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { newKnowledgeAddSourcePath } from './routes'

type SourceStatus = Source['status']
type SourceFilter = SourceStatus | 'all'

const PAGE_SIZE = 50

const statusDotClassName: Record<SourceStatus, string> = {
  active: 'bg-components-badge-status-light-success-bg',
  syncing: 'animate-pulse bg-components-badge-status-light-warning-bg motion-reduce:animate-none',
  disabled: 'bg-components-badge-status-light-disabled-bg',
  error: 'bg-components-badge-status-light-error-bg',
}

function metadataString(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function SourceActions({ source }: { source: Source }) {
  const { t } = useTranslation('dataset')
  const unavailableProps = { disabled: true, 'aria-disabled': true } as const

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t(($) => $['newKnowledge.sourceActions'], { name: source.name })}
        className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
        <DropdownMenuItem {...unavailableProps} className="gap-2 px-3">
          <span aria-hidden className="i-ri-refresh-line size-4" />
          {t(($) => $['newKnowledge.syncNow'])}
        </DropdownMenuItem>
        <DropdownMenuItem {...unavailableProps} className="gap-2 px-3">
          <span aria-hidden className="i-ri-edit-line size-4" />
          {t(($) => $['newKnowledge.editSource'])}
        </DropdownMenuItem>
        <DropdownMenuItem {...unavailableProps} className="gap-2 px-3">
          <span aria-hidden className="i-ri-indeterminate-circle-line size-4" />
          {t(($) => $['newKnowledge.disableSource'])}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem {...unavailableProps} variant="destructive" className="gap-2 px-3">
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          {t(($) => $['newKnowledge.removeSource'])}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SourceRow({ source }: { source: Source }) {
  const { t } = useTranslation('dataset')
  const providerName = metadataString(source.metadata, 'providerName')
  const syncPolicy = metadataString(source.metadata, 'syncPolicy')
  const lastSync = metadataString(source.metadata, 'lastSyncedAt')
  const typeLabel = providerName ?? t(($) => $[`newKnowledge.sourceType.${source.type}`])

  return (
    <tr
      className={cn('border-t border-divider-subtle', source.status === 'disabled' && 'opacity-60')}
    >
      <td className="min-w-64 py-2 pr-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              'size-[18px] shrink-0 text-text-tertiary',
              source.type === 'web' ? 'i-ri-global-line' : 'i-ri-links-line',
            )}
          />
          <div className="min-w-0">
            <p className="truncate system-xs-medium text-text-primary">{source.name}</p>
            <p className="truncate system-2xs-regular text-text-tertiary">{source.uri}</p>
          </div>
        </div>
      </td>
      <td className="w-44 py-2 pr-3 system-xs-regular text-text-secondary">{typeLabel}</td>
      <td className="w-32 py-2 pr-3">
        <span className="inline-flex items-center gap-1.5 system-xs-medium text-text-secondary">
          <span
            aria-hidden
            className={cn('size-1.5 rounded-[2px]', statusDotClassName[source.status])}
          />
          {t(($) => $[`newKnowledge.sourceStatus.${source.status}`])}
        </span>
      </td>
      <td className="w-32 py-2 pr-3 system-xs-regular text-text-secondary">{syncPolicy ?? '—'}</td>
      <td className="w-40 py-2 pr-3 system-xs-regular text-text-secondary">{lastSync ?? '—'}</td>
      <td className="w-12 py-2 text-right">
        <SourceActions source={source} />
      </td>
    </tr>
  )
}

function SourcesEmpty({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div aria-hidden className="flex -space-x-2">
        {['i-ri-fire-line', 'i-ri-global-line', 'i-ri-file-text-line', 'i-ri-folder-line'].map(
          (icon) => (
            <span
              key={icon}
              className="flex size-9 items-center justify-center rounded-lg border border-divider-subtle bg-background-default shadow-xs"
            >
              <span className={`${icon} size-4 text-text-tertiary`} />
            </span>
          ),
        )}
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
    }),
  )
  const sources = sourcesQuery.data?.pages.flatMap((page) => page.items)
  const filteredSources = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return (sources ?? []).filter((source) => {
      if (filter !== 'all' && source.status !== filter) return false
      if (!normalizedSearch) return true
      return `${source.name} ${source.uri}`.toLocaleLowerCase().includes(normalizedSearch)
    })
  }, [filter, search, sources])

  if (sourcesQuery.isPending)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loading />
      </div>
    )

  if (sourcesQuery.error && !sourcesQuery.data)
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
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
    )

  if (!sources?.length) return <SourcesEmpty knowledgeSpaceId={knowledgeSpaceId} />

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
        <Link
          href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
          className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addSource'])}
        </Link>
      </header>
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
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="system-2xs-medium text-text-tertiary uppercase">
            <tr>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.sourceColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['metadata.createMetadata.type'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.statusColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.syncPolicyColumn'])}</th>
              <th className="pb-2 font-medium">{t(($) => $['newKnowledge.lastSyncColumn'])}</th>
              <th aria-label={t(($) => $['newKnowledge.actionsColumn'])} />
            </tr>
          </thead>
          <tbody>
            {filteredSources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </tbody>
        </table>
        {!filteredSources.length && (
          <p className="py-16 text-center body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.noMatchingSources'])}
          </p>
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
      ) : sourcesQuery.hasNextPage ? (
        <div className="mt-5 flex justify-center">
          <Button
            loading={sourcesQuery.isFetchingNextPage}
            onClick={() => void sourcesQuery.fetchNextPage()}
          >
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      ) : null}
    </main>
  )
}
