'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue } from 'jotai'
import { debounce, useQueryState } from 'nuqs'
import { useTranslation } from '#i18n'
import { StudioListHeader } from '@/app/components/apps/studio-list-header'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../shared/components/empty-state'
import { useInfiniteScroll } from '../../shared/hooks/use-infinite-scroll'
import {
  deploymentsListHasFilterAtom,
  deploymentsListQueryAtom,
  deploymentsListRowsAtom,
  deploymentsListShowEmptyStateAtom,
  deploymentsListShowErrorStateAtom,
  deploymentsListShowSkeletonAtom,
  envFilterQueryState,
  keywordsQueryState,
} from '../state'
import { CreateDeploymentButton } from './create-deployment-button'
import { EnvironmentFilter } from './environment-filter'
import { InstanceCard } from './instance-card'

const INSTANCE_CARD_SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']

function DeploymentsListState({ children }: {
  children: ReactNode
}) {
  return <DeploymentStateMessage variant="page">{children}</DeploymentStateMessage>
}

function DeploymentsListEmpty() {
  const { t } = useTranslation('deployments')
  const hasFilter = useAtomValue(deploymentsListHasFilterAtom)
  const [_keywords, setKeywords] = useQueryState('keywords', keywordsQueryState)
  const [_envFilter, setEnvFilter] = useQueryState('env', envFilterQueryState)

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
      shallow: false,
    })
  }

  return (
    <div className={cn('relative w-50', className)}>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" />
      <Input
        className="h-8 pr-8 pl-8"
        aria-label={t('filter.searchPlaceholder')}
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
  const { t } = useTranslation()

  return (
    <StudioListHeader
      title={(
        <div className="flex items-center">
          <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">{t('menus.deployments', { ns: 'common' })}</h1>
        </div>
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
          <EnvironmentFilter className="min-w-0" />
          <CreateDeploymentButton className="shrink-0 sm:hidden" />
        </div>
        <DeploymentsSearchInput className="w-full sm:w-50 sm:shrink-0" />
        <CreateDeploymentButton className="hidden shrink-0 sm:ml-auto sm:inline-flex" />
      </div>
    </StudioListHeader>
  )
}

export function DeploymentsListShell() {
  const { t } = useTranslation('deployments')
  const deploymentsListQuery = useAtomValue(deploymentsListQueryAtom)
  const appInstanceSummaries = useAtomValue(deploymentsListRowsAtom)
  const showSkeleton = useAtomValue(deploymentsListShowSkeletonAtom)
  const showErrorState = useAtomValue(deploymentsListShowErrorStateAtom)
  const showEmptyState = useAtomValue(deploymentsListShowEmptyStateAtom)

  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement>(deploymentsListQuery)

  return (
    <div ref={rootRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
      <DeploymentsListControls />
      <div className={cn(
        'relative grid grow grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] content-start gap-4 px-8 pt-2 pb-8',
        showEmptyState && 'overflow-hidden',
      )}
      >
        {showSkeleton
          ? <DeploymentsListSkeleton />
          : showErrorState
            ? <DeploymentsListState>{t('common.loadFailed')}</DeploymentsListState>
            : showEmptyState
              ? <DeploymentsListEmpty />
              : appInstanceSummaries.map(summary => (
                  <InstanceCard
                    key={summary.appInstance.id}
                    summary={summary}
                  />
                ))}
        {deploymentsListQuery.isFetchingNextPage && <DeploymentsListSkeleton />}
        <div ref={sentinelRef} aria-hidden="true" className="col-span-full h-px" />
      </div>
    </div>
  )
}
