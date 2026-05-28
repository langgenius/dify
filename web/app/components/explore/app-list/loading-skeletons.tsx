'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

export function RecommendationSectionSkeleton({
  className,
  hasDescription = false,
}: {
  className?: string
  hasDescription?: boolean
}) {
  const { t } = useTranslation()

  return (
    <section className={cn('px-12 pb-6', className)} role="status" aria-label={t('loading', { ns: 'common' })}>
      <SkeletonContainer>
        <div className="flex min-h-12 items-end justify-between gap-4 pb-2">
          <div className="min-w-0 flex-1">
            <SkeletonRectangle className="h-5 w-48 animate-pulse" />
            {hasDescription && <SkeletonRectangle className="mt-2 h-3 w-80 animate-pulse" />}
          </div>
          {hasDescription && <SkeletonRectangle className="h-4 w-8 animate-pulse" />}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3 shadow-md">
              <SkeletonRow>
                <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
                  <SkeletonRectangle className="h-3 w-1/2 animate-pulse" />
                </div>
              </SkeletonRow>
              {hasDescription && (
                <div className="mt-3 flex flex-col gap-1">
                  <SkeletonRectangle className="h-3 w-full animate-pulse" />
                  <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
                </div>
              )}
            </div>
          ))}
        </div>
      </SkeletonContainer>
    </section>
  )
}

export function ExploreHeaderSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('loading', { ns: 'common' })} className="sticky top-0 z-10 bg-background-body">
      <div className="px-12 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <SkeletonRectangle className="h-6 w-32 animate-pulse" />
          <SkeletonRectangle className="h-3 w-80 animate-pulse" />
        </div>
      </div>
      <div className="flex items-end justify-between gap-4 px-12 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonRectangle key={index} className="h-7 w-24 animate-pulse rounded-lg" />
          ))}
        </div>
        <SkeletonRectangle className="h-8 w-[200px] shrink-0 animate-pulse rounded-lg" />
      </div>
    </div>
  )
}

function ExploreAppCardSkeleton() {
  return (
    <div className="col-span-1 flex h-[142px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <SkeletonContainer className="h-full px-4 pt-4">
        <SkeletonRow>
          <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
            <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
          </div>
        </SkeletonRow>
        <div className="mt-3 flex flex-col gap-1">
          <SkeletonRectangle className="h-3 w-full animate-pulse" />
          <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
        </div>
        <div className="mt-auto flex gap-1 pb-1">
          <SkeletonRectangle className="h-5 w-20 animate-pulse rounded-[5px]" />
          <SkeletonRectangle className="h-5 w-16 animate-pulse rounded-[5px]" />
        </div>
      </SkeletonContainer>
    </div>
  )
}

export function ExploreAppListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('loading', { ns: 'common' })} className="contents">
      {Array.from({ length: 8 }, (_, index) => (
        <ExploreAppCardSkeleton key={index} />
      ))}
    </div>
  )
}
