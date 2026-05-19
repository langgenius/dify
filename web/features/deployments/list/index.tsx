'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { debounce, useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../data'
import { CreateDeploymentButton } from './create-deployment-button'
import { EnvironmentFilter } from './environment-filter'
import { InstanceCard } from './instance-card'
import { envFilterQueryState, keywordsQueryState } from './query-state'

const INSTANCE_CARD_SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const EMPTY_INSTANCE_CARD_KEYS = Array.from({ length: 36 }, (_, index) => `empty-instance-card-${index}`)

function DeploymentsListState({ children }: {
  children: ReactNode
}) {
  return (
    <div className="col-span-full rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-12 text-center system-sm-regular text-text-tertiary">
      {children}
    </div>
  )
}

function DeploymentsListEmpty() {
  const { t } = useTranslation('deployments')

  return (
    <>
      {EMPTY_INSTANCE_CARD_KEYS.map(key => (
        <div
          key={key}
          className="inline-flex h-40 rounded-xl bg-background-default-lighter"
        />
      ))}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-linear-to-t from-background-body to-transparent">
        <span className="system-md-medium text-text-tertiary">
          {t('list.empty')}
        </span>
      </div>
    </>
  )
}

function InstanceCardSkeleton() {
  return (
    <div className="relative col-span-1 inline-flex h-40 flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs">
      <div className="flex h-16.5 shrink-0 grow-0 items-center gap-3 px-3.5 pt-3.5 pb-3">
        <div className="relative shrink-0">
          <SkeletonRectangle className="my-0 size-10 animate-pulse rounded-lg" />
          <SkeletonRectangle className="absolute -right-0.5 -bottom-0.5 my-0 size-4 animate-pulse rounded-sm shadow-xs" />
        </div>
        <div className="flex w-0 grow flex-col gap-1.5 py-px">
          <SkeletonRectangle className="my-0 h-3.5 w-2/3 animate-pulse" />
          <SkeletonRectangle className="my-0 h-2.5 w-1/3 animate-pulse" />
        </div>
      </div>
      <div className="flex grow flex-col gap-2 px-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <SkeletonRectangle className="my-0 size-3.5 animate-pulse rounded-sm" />
          <SkeletonRectangle className="my-0 h-3 w-3/4 animate-pulse" />
        </div>
      </div>
      <div className="absolute right-0 bottom-1 left-0 flex h-10.5 shrink-0 items-center pt-1 pr-12 pb-1.5 pl-3.5">
        <div className="flex min-w-0 grow items-center gap-1.5">
          <SkeletonRectangle className="my-0 size-3.5 animate-pulse rounded-sm" />
          <SkeletonRectangle className="my-0 h-3 w-1/2 animate-pulse" />
        </div>
      </div>
      <div className="absolute right-1.5 bottom-1 flex h-10.5 w-8 items-center justify-center">
        <SkeletonRectangle className="my-0 h-1 w-4 animate-pulse rounded-full" />
      </div>
    </div>
  )
}

function DeploymentsListSkeleton() {
  return INSTANCE_CARD_SKELETON_KEYS.map(key => (
    <InstanceCardSkeleton key={key} />
  ))
}

function DeploymentsSearchInput() {
  const { t } = useTranslation('deployments')
  const [keywords, setKeywords] = useQueryState('keywords', keywordsQueryState)

  function handleKeywordsChange(next: string) {
    void setKeywords(next.trim() ? next : null, {
      limitUrlUpdates: next.trim() ? debounce(300) : undefined,
    })
  }

  return (
    <Input
      showLeftIcon
      showClearIcon
      wrapperClassName="w-50"
      placeholder={t('filter.searchPlaceholder')}
      value={keywords}
      onChange={e => handleKeywordsChange(e.target.value)}
      onClear={() => handleKeywordsChange('')}
    />
  )
}

function DeploymentsListControls() {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background-body px-12 pt-7 pb-5">
      <div className="flex items-center gap-2">
        <EnvironmentFilter />
        <DeploymentsSearchInput />
      </div>
      <CreateDeploymentButton />
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
    ...consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
      input: pageParam => ({
        query: {
          pageNumber: Number(pageParam),
          resultsPerPage: SOURCE_APPS_PAGE_SIZE,
          ...(envFilter === 'not-deployed' ? { notDeployed: true } : {}),
          ...(queryKeywords ? { query: queryKeywords } : {}),
        },
      }),
      getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const pages = data?.pages ?? []
  const apps = pages.flatMap(page => page.data ?? [])
  const showSkeleton = isLoading || (isFetching && pages.length === 0)
  const showEmptyState = !showSkeleton && !isError && apps.length === 0

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
        'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
        showEmptyState && 'overflow-hidden',
      )}
      >
        {showSkeleton
          ? <DeploymentsListSkeleton />
          : isError
            ? <DeploymentsListState>{t('common.loadFailed')}</DeploymentsListState>
            : apps.length === 0
              ? <DeploymentsListEmpty />
              : apps.map(app => (
                  <InstanceCard
                    key={app.id}
                    app={app}
                  />
                ))}
        {isFetchingNextPage && <DeploymentsListSkeleton />}
      </div>

      <div ref={anchorRef} className="h-0" />
      <div className="py-4" />
    </div>
  )
}
