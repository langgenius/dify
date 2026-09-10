'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { HomeIntroSkeleton } from './home-intro'

function HomeTemplateCardSkeleton() {
  return (
    <div className="col-span-1 flex h-35.5 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative shrink-0">
          <SkeletonRectangle className="my-0 size-10 shrink-0 animate-pulse rounded-lg" />
        </div>
        <div className="flex w-0 grow flex-col gap-1 py-px">
          <SkeletonRectangle className="my-0 h-4 w-3/5 animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-16 animate-pulse" />
        </div>
      </div>
      <div className="flex shrink-0 items-start px-4 py-1">
        <div className="flex flex-1 flex-col gap-1">
          <SkeletonRectangle className="my-0 h-3 w-full animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

function HomeTemplatesHeaderSkeletonBody() {
  return (
    <div className="sticky top-0 z-10 bg-background-body">
      <div className="flex items-center gap-2 px-8 pt-6">
        <div className="min-w-0 flex-1">
          <SkeletonRectangle className="my-0 h-6 w-32 animate-pulse" />
        </div>
        <SkeletonRectangle className="my-0 h-4 w-20 shrink-0 animate-pulse" />
      </div>
      <div className="flex items-start justify-between gap-2 px-8 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {Array.from({ length: 8 }, (_, index) => (
            <SkeletonRectangle
              key={index}
              className={cn(
                'my-0 h-8 shrink-0 animate-pulse rounded-lg',
                ['w-12', 'w-18', 'w-32', 'w-32', 'w-32', 'w-36', 'w-28', 'w-28'][index],
              )}
            />
          ))}
        </div>
        <SkeletonRectangle className="my-0 h-8 w-40 shrink-0 animate-pulse rounded-lg" />
      </div>
    </div>
  )
}

function HomeTemplatesSkeletonBody() {
  return (
    <div className={cn('shrink-0 content-start gap-2.5 px-8', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)}>
      {Array.from({ length: 8 }, (_, index) => (
        <HomeTemplateCardSkeleton key={index} />
      ))}
    </div>
  )
}

function HomeBannerSkeleton() {
  return (
    <div className="relative flex w-full flex-col items-start px-8 pb-4">
      <div className="@container/banner w-full">
        <SkeletonRectangle className="my-0 h-56 w-full animate-pulse rounded-2xl @min-[996px]/banner:h-46" />
      </div>
    </div>
  )
}

export function HomeSkeleton({ showBanner }: { showBanner: boolean }) {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t(($) => $.loading, { ns: 'common' })} className="contents">
      <HomeIntroSkeleton />
      {showBanner && <HomeBannerSkeleton />}
      <HomeTemplatesHeaderSkeletonBody />
      <div className="relative flex flex-1 shrink-0 grow flex-col pb-6">
        <HomeTemplatesSkeletonBody />
      </div>
    </div>
  )
}
