'use client'

import type { ListAppInstanceSummariesReply } from '@dify/contracts/enterprise/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { debounce, useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DeploymentEmptyState, DeploymentStateMessage } from '../components/empty-state'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../data'
import { deploymentStatusPollingInterval } from '../runtime-status'
import { CreateDeploymentButton } from './create-deployment-button'
import { EnvironmentFilter } from './environment-filter'
import { InstanceCard } from './instance-card'
import {
  envFilterQueryState,
  keywordsQueryState,
} from './query-state'

const INSTANCE_CARD_SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']

function listDeploymentStatusPollingInterval(data?: InfiniteData<ListAppInstanceSummariesReply>) {
  const rows = data?.pages?.flatMap(page =>
    page.data.flatMap(summary => summary.environmentDeployments),
  ) ?? []

  return deploymentStatusPollingInterval(rows)
}

function DeploymentsListState({ children }: {
  children: ReactNode
}) {
  return <DeploymentStateMessage variant="page">{children}</DeploymentStateMessage>
}

function DeploymentsListEmpty() {
  const { t } = useTranslation('deployments')
  const [keywords, setKeywords] = useQueryState('keywords', keywordsQueryState)
  const [envFilter, setEnvFilter] = useQueryState('env', envFilterQueryState)
  const hasFilter = Boolean(keywords.trim()) || Boolean(envFilter)

  function clearFilters() {
    void setKeywords(null)
    void setEnvFilter(null)
  }

  return (
    <DeploymentEmptyState
      variant="page"
      icon={hasFilter ? 'i-ri-search-line' : 'i-ri-rocket-line'}
      title={hasFilter ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
      description={hasFilter ? t('list.emptyFilteredDescription') : t('list.emptyDescription')}
      action={hasFilter
        ? (
            <Button variant="secondary" size="small" onClick={clearFilters}>
              {t('list.clearFilters')}
            </Button>
          )
        : <CreateDeploymentButton />}
    />
  )
}

function InstanceCardSkeleton() {
  return (
    <div className="col-span-1 inline-flex min-h-40 min-w-0 flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-w-0 px-4 pt-4">
          <SkeletonRectangle className="my-0 h-4 w-2/5 animate-pulse" />
          <SkeletonRectangle className="mt-2 h-3 w-3/5 animate-pulse" />
        </div>

        <div className="min-h-8 px-4 pt-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
            <SkeletonRectangle className="my-0 h-5 w-22 animate-pulse rounded-md" />
          </div>
        </div>

        <div className="mt-auto flex h-11 min-w-0 items-center border-t border-divider-subtle px-4">
          <div className="flex min-w-0 grow items-center gap-2">
            <SkeletonRectangle className="my-0 size-3.5 animate-pulse rounded-sm" />
            <SkeletonRectangle className="my-0 h-3 w-18 animate-pulse" />
          </div>
          <SkeletonRectangle className="my-0 h-3 w-24 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

function DeploymentsListSkeleton() {
  return INSTANCE_CARD_SKELETON_KEYS.map(key => (
    <InstanceCardSkeleton key={key} />
  ))
}

function DeploymentsSearchInput({ className }: {
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const [keywords, setKeywords] = useQueryState('keywords', keywordsQueryState)

  function handleKeywordsChange(next: string) {
    void setKeywords(next.trim() ? next : null, {
      limitUrlUpdates: next.trim() ? debounce(300) : undefined,
    })
  }

  return (
    <div className={cn('relative w-50', className)}>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" />
      <Input
        className="h-8 pr-8 pl-8"
        placeholder={t('filter.searchPlaceholder')}
        value={keywords}
        onChange={e => handleKeywordsChange(e.target.value)}
      />
      {keywords && (
        <button
          type="button"
          aria-label={t('list.clearSearch')}
          className="absolute top-1/2 right-2.5 flex size-4 -translate-y-1/2 items-center justify-center text-text-quaternary hover:text-text-secondary"
          onClick={() => handleKeywordsChange('')}
        >
          <span aria-hidden className="i-ri-close-circle-fill size-4" />
        </button>
      )}
    </div>
  )
}

function DeploymentsListControls() {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background-body px-4 pt-5 pb-4 sm:px-6 lg:px-12 lg:pt-7 lg:pb-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
          <EnvironmentFilter className="min-w-0" />
          <CreateDeploymentButton className="shrink-0 sm:hidden" />
        </div>
        <DeploymentsSearchInput className="w-full sm:w-50 sm:shrink-0" />
        <CreateDeploymentButton className="hidden shrink-0 sm:ml-auto sm:inline-flex" />
      </div>
    </div>
  )
}

export function DeploymentsList() {
  const { t } = useTranslation('deployments')
  const [envFilter] = useQueryState('env', envFilterQueryState)
  const [keywords] = useQueryState('keywords', keywordsQueryState)
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const queryKeywords = keywords.trim()
  const queryEnvironmentId = envFilter ?? undefined

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    ...consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.infiniteOptions({
      input: pageParam => ({
        query: {
          pageNumber: Number(pageParam),
          resultsPerPage: SOURCE_APPS_PAGE_SIZE,
          ...(queryEnvironmentId ? { environmentId: queryEnvironmentId } : {}),
          ...(queryKeywords ? { name: queryKeywords } : {}),
        },
      }),
      getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    refetchInterval: query => listDeploymentStatusPollingInterval(query.state.data),
  })
  const pages = data?.pages ?? []
  const appInstanceSummaries = pages.flatMap(page => page.data)
  const showSkeleton = isLoading || (isFetching && pages.length === 0)
  const showEmptyState = !showSkeleton && !isError && appInstanceSummaries.length === 0

  useEffect(() => {
    if (!hasNextPage || isLoading || isFetchingNextPage || error)
      return

    const anchor = anchorRef.current
    const container = containerRef.current
    if (!anchor || !container)
      return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting)
        void fetchNextPage()
    }, {
      root: container,
      rootMargin: '160px',
      threshold: 0.1,
    })

    observer.observe(anchor)
    return () => observer.disconnect()
  }, [error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading])

  return (
    <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
      <DeploymentsListControls />
      <div className={cn(
        'relative grid grow grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] content-start gap-4 px-4 pt-2 sm:px-6 lg:px-12',
        showEmptyState && 'overflow-hidden',
      )}
      >
        {showSkeleton
          ? <DeploymentsListSkeleton />
          : isError
            ? <DeploymentsListState>{t('common.loadFailed')}</DeploymentsListState>
            : appInstanceSummaries.length === 0
              ? <DeploymentsListEmpty />
              : appInstanceSummaries.map(summary => (
                  <InstanceCard
                    key={summary.appInstance.id}
                    summary={summary}
                  />
                ))}
        {isFetchingNextPage && <DeploymentsListSkeleton />}
      </div>

      <div ref={anchorRef} className="h-0" />
      <div className="py-4" />
    </div>
  )
}
