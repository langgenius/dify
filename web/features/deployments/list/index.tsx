'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { debounce, useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DeployDrawer } from '../components/deploy-drawer'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../data'
import { CreateDeploymentButton } from './create-deployment-button'
import { EnvironmentFilter } from './environment-filter'
import { InstanceCard } from './instance-card'
import {
  envFilterQueryState,
  environmentIdFromFilterValue,
  keywordsQueryState,
} from './query-state'

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
    <div className="col-span-1 inline-flex h-40 min-w-0 flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-w-0 px-4 pt-4">
          <SkeletonRectangle className="my-0 h-4 w-2/5 animate-pulse" />
          <div className="mt-2 flex min-h-9 flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-3/5 animate-pulse" />
          </div>
        </div>

        <div className="min-h-7 px-4 pt-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
            <SkeletonRectangle className="my-0 h-5 w-22 animate-pulse rounded-md" />
          </div>
        </div>

        <div className="mt-auto flex h-10.5 min-w-0 items-center border-t border-divider-subtle px-4">
          <div className="flex min-w-0 grow items-center gap-2">
            <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-sm" />
            <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-sm" />
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

function DeploymentsSearchInput() {
  const { t } = useTranslation('deployments')
  const [keywords, setKeywords] = useQueryState('keywords', keywordsQueryState)

  function handleKeywordsChange(next: string) {
    void setKeywords(next.trim() ? next : null, {
      limitUrlUpdates: next.trim() ? debounce(300) : undefined,
    })
  }

  return (
    <div className="relative w-50">
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
  const queryEnvironmentId = environmentIdFromFilterValue(envFilter)

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
          ...(queryEnvironmentId ? { environmentId: queryEnvironmentId } : {}),
          ...(queryKeywords ? { name: queryKeywords } : {}),
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
    <>
      <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        <DeploymentsListControls />
        <div className={cn(
          'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
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
      <DeployDrawer />
    </>
  )
}
