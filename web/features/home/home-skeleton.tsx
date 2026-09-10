'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
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
      <div className="relative flex h-6.5 w-full shrink-0 flex-col gap-2 overflow-hidden px-3">
        <div className="flex w-full shrink-0 items-center gap-1 rounded-lg p-1">
          <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-[5px]" />
        </div>
      </div>
    </div>
  )
}

function HomeRecommendationsSkeleton() {
  return (
    <SkeletonContainer className="gap-0">
      <div className="flex items-center justify-between pt-2">
        <div className="min-w-0 flex-1">
          <SkeletonRectangle className="my-0 h-6 w-48 animate-pulse" />
        </div>
      </div>
      <div className={cn('gap-2.5 pt-2', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)}>
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-4 shadow-md"
          >
            <SkeletonRow className="gap-3">
              <SkeletonRectangle className="my-0 size-10 shrink-0 animate-pulse rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <SkeletonRectangle className="my-0 h-4 w-2/3 animate-pulse" />
                <SkeletonRectangle className="my-0 h-3 w-1/2 animate-pulse" />
              </div>
            </SkeletonRow>
          </div>
        ))}
      </div>
    </SkeletonContainer>
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
        <div className="flex min-w-0 flex-1 gap-1">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonRectangle key={index} className="my-0 h-8 w-24 animate-pulse rounded-lg" />
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
      <section className="px-8 pb-5">
        <HomeRecommendationsSkeleton />
      </section>
      <HomeTemplatesHeaderSkeletonBody />
      <div className="relative flex flex-1 shrink-0 grow flex-col pb-6">
        <HomeTemplatesSkeletonBody />
      </div>
    </div>
  )
}
